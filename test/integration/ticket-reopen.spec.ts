import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Macro, Ticket, TicketStatus } from '../../src/entities';
import { WorkflowExecutorService } from '../../src/services/workflow-executor.service';
import { apiFetch, bootUi, CUSTOMER, inertiaFetch } from './ui-harness';

jest.setTimeout(60000);

/**
 * Reopening a resolved or closed ticket clears `resolvedAt` and `closedAt`, as
 * escalated-laravel's markReopened does, on every path that moves a ticket
 * back to an open status: the agent API, the screen status action, the
 * customer's reopen action, bulk actions, macros and workflows. Without it the
 * agent pages showed a reopened ticket's resolution SLA as finished.
 */
describe('reopening a ticket clears resolvedAt and closedAt', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let resolved: TicketStatus;
  let closed: TicketStatus;
  let seq = 0;

  const asAdmin = { as: 'admin' as const };
  const tickets = () => source.getRepository(Ticket);
  const fresh = (id: number) => tickets().findOneByOrFail({ id });
  const stamp = new Date('2026-11-01T10:00:00.000Z');

  /** A ticket solved earlier: in `status`, with both stamps set. */
  const solvedTicket = (status: TicketStatus = resolved) =>
    tickets().save({
      referenceNumber: `RO-${++seq}`,
      subject: 'Reopen me',
      description: 'x',
      priority: 'medium',
      channel: 'web',
      requesterId: CUSTOMER,
      statusId: status.id,
      resolvedAt: stamp,
      closedAt: stamp,
    } as Partial<Ticket>);

  const expectReopened = async (id: number, statusId: number) => {
    const after = await fresh(id);
    expect(after.statusId).toBe(statusId);
    expect(after.resolvedAt).toBeNull();
    expect(after.closedAt).toBeNull();
  };

  /** A screen action as the shared UI posts it; answers with a redirect. */
  const action = (path: string, body: unknown, as: 'admin' | 'customer' = 'admin') =>
    inertiaFetch(base, path, { as, body, headers: { referer: `${base}/escalated` } });

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true, sortOrder: 1 });
    resolved = await statuses.save({ name: 'Resolved', slug: 'resolved', isClosed: true });
    closed = await statuses.save({ name: 'Closed', slug: 'closed', isClosed: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('through the agent API status change', async () => {
    const t = await solvedTicket();
    const res = await apiFetch(base, `/escalated/agent/tickets/${t.id}`, {
      ...asAdmin,
      method: 'PUT',
      body: { statusId: open.id },
    });
    expect(res.status).toBe(200);
    await expectReopened(t.id, open.id);
  });

  it('through the agent screen status action, from closed', async () => {
    const t = await solvedTicket(closed);
    const res = await action(`/escalated/agent/tickets/${t.referenceNumber}/status`, {
      status: 'open',
    });
    expect(res.status).toBe(303);
    await expectReopened(t.id, open.id);
  });

  it("through the customer's reopen action", async () => {
    const t = await solvedTicket();
    const res = await action(
      `/escalated/customer/tickets/${t.referenceNumber}/reopen`,
      {},
      'customer',
    );
    expect(res.status).toBe(303);
    await expectReopened(t.id, open.id);
  });

  it('through the bulk status action', async () => {
    const [a, b] = [await solvedTicket(), await solvedTicket(closed)];
    const res = await action('/escalated/admin/tickets/bulk', {
      ticket_ids: [a.id, b.id],
      action: 'status',
      value: 'open',
    });
    expect(res.status).toBe(303);
    await expectReopened(a.id, open.id);
    await expectReopened(b.id, open.id);
  });

  it.each(['status', 'set_status'])('through a macro %s action', async (type) => {
    const macro = await source.getRepository(Macro).save({
      name: `Reopen (${type})`,
      scope: 'shared',
      isActive: true,
      actions: [{ type, value: 'open' }],
    } as Partial<Macro>);
    const t = await solvedTicket();
    const res = await action(`/escalated/agent/tickets/${t.referenceNumber}/macro`, {
      macro_id: macro.id,
    });
    expect(res.status).toBe(303);
    await expectReopened(t.id, open.id);
  });

  it('through a workflow change_status action', async () => {
    const t = await solvedTicket();
    await app
      .get(WorkflowExecutorService)
      .execute(await fresh(t.id), [{ type: 'change_status', value: 'open' }]);
    await expectReopened(t.id, open.id);
  });

  it('stamps fresh times when a reopened ticket is resolved again', async () => {
    const t = await solvedTicket();
    await action(`/escalated/agent/tickets/${t.referenceNumber}/status`, { status: 'open' });
    await action(`/escalated/agent/tickets/${t.referenceNumber}/status`, { status: 'resolved' });
    const after = await fresh(t.id);
    expect(after.resolvedAt).not.toBeNull();
    expect(new Date(after.resolvedAt).getTime()).toBeGreaterThan(stamp.getTime());
    expect(after.closedAt).not.toBeNull();
  });

  it('keeps the stamps when a solved ticket moves to another solved status', async () => {
    const t = await solvedTicket();
    await action(`/escalated/agent/tickets/${t.referenceNumber}/status`, { status: 'closed' });
    const after = await fresh(t.id);
    expect(after.statusId).toBe(closed.id);
    expect(new Date(after.resolvedAt).toISOString()).toBe(stamp.toISOString());
    expect(new Date(after.closedAt).toISOString()).toBe(stamp.toISOString());
  });
});
