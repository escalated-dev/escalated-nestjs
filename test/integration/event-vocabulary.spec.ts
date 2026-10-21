import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import {
  Department,
  EscalationRule,
  SlaPolicy,
  Tag,
  Ticket,
  TicketActivity,
  TicketStatus,
  Webhook,
  Workflow,
  WorkflowLog,
} from '../../src/entities';
import { SlaService } from '../../src/services/sla.service';
import { EscalationService } from '../../src/services/escalation.service';
import { CANONICAL_EVENTS, LEGACY_EVENT_NAMES } from '../../src/events/event-names';
import { GuestOutbox } from './guest-codes';

jest.setTimeout(60000);

/**
 * The shared event vocabulary (ADR 2026-10-21) over real HTTP + SQLite: each
 * domain change reaches outbound webhooks and workflows under its canonical
 * name, and stored legacy names keep working.
 */

const guardFor = (role: string): CanActivate => ({
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!String(req.headers['x-role'] ?? '').includes(role)) return false;
    if (req.headers['x-user']) req.user = { id: Number(req.headers['x-user']) };
    return true;
  },
});

const HOOK_ALL = 'https://1.1.1.1/all';
const HOOK_LEGACY = 'https://1.0.0.1/legacy';
const AGENT = 21;
const OTHER_AGENT = 22;

describe('shared event vocabulary', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let fetchMock: jest.SpyInstance;
  let open: TicketStatus;
  let resolved: TicketStatus;
  let closed: TicketStatus;
  let sales: Department;
  let billing: Department;
  let seq = 0;
  const realFetch = globalThis.fetch;
  const outbox = new GuestOutbox();
  const chatProof = (email: string) => outbox.proof(`${base}/escalated/widget`, email, 'chat');

  const agent = (method: string, path: string, body?: unknown, who = AGENT) =>
    realFetch(`${base}${path}`, {
      method,
      headers: {
        'x-role': 'agent,admin',
        'x-user': String(who),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const publicCall = (method: string, path: string, body?: unknown) =>
    realFetch(`${base}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  /** Webhook deliveries to `url` so far: `[event, data]`. */
  const delivered = (url = HOOK_ALL): Array<[string, any]> =>
    fetchMock.mock.calls
      .filter(([target]) => String(target) === url)
      .map(([, init]) => {
        const body = JSON.parse(init.body);
        return [body.event, body.data];
      });
  const names = (url = HOOK_ALL) => delivered(url).map(([event]) => event);

  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
    // Let any other handler of the same event finish too.
    await new Promise((r) => setTimeout(r, 30));
  };

  const ticket = (extra: Partial<Ticket> = {}) =>
    source.getRepository(Ticket).save({
      referenceNumber: `EV-${++seq}`,
      subject: 'Vocabulary',
      description: 'Details',
      requesterId: 5,
      statusId: open.id,
      priority: 'medium',
      ...extra,
    } as Partial<Ticket>);

  beforeAll(async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      if (String(url).startsWith('https://')) return new Response('ok', { status: 200 });
      return realFetch(url, init);
    });

    const moduleRef = await bootEscalatedModule({
      escalated: {
        adminGuard: guardFor('admin'),
        agentGuard: guardFor('agent'),
        customerGuard: guardFor('customer'),
        guestAccess: outbox.options(),
      },
    });
    source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();

    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true, isClosed: false });
    resolved = await statuses.save({ name: 'Resolved', slug: 'resolved', isClosed: true });
    closed = await statuses.save({ name: 'Closed', slug: 'closed', isClosed: true });
    sales = await source.getRepository(Department).save({ name: 'Sales', slug: 'sales' });
    billing = await source.getRepository(Department).save({ name: 'Billing', slug: 'billing' });

    await source.getRepository(Webhook).save([
      { name: 'all', url: HOOK_ALL, secret: 's', events: ['*'], isActive: true },
      {
        name: 'legacy',
        url: HOOK_LEGACY,
        secret: 's',
        // Names stored by earlier releases.
        events: ['ticket.reply_created', 'ticket.tagged', 'internal_note.added'],
        isActive: true,
      },
    ]);

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    fetchMock.mockRestore();
  });

  beforeEach(() => fetchMock.mockClear());

  it('keeps one vocabulary: legacy names all read as canonical ones', () => {
    for (const canonical of Object.values(LEGACY_EVENT_NAMES)) {
      expect(CANONICAL_EVENTS).toContain(canonical);
    }
  });

  it('sends ticket.unassigned, not ticket.assigned with no assignee', async () => {
    const t = await ticket({ assigneeId: AGENT } as any);

    const res = await agent('PUT', `/escalated/agent/tickets/${t.id}`, { assigneeId: null });
    expect(res.status).toBe(200);
    await settle(() => names().includes('ticket.unassigned'));

    expect(names()).toContain('ticket.unassigned');
    expect(names()).not.toContain('ticket.assigned');
    const [, data] = delivered().find(([event]) => event === 'ticket.unassigned')!;
    expect(data).toMatchObject({ ticket: { id: t.id }, previousAssigneeId: AGENT });
  });

  it('sends ticket.assigned when an agent is assigned', async () => {
    const t = await ticket();
    await agent('PUT', `/escalated/agent/tickets/${t.id}`, { assigneeId: OTHER_AGENT });
    await settle(() => names().includes('ticket.assigned'));
    expect(names()).toContain('ticket.assigned');
    expect(names()).not.toContain('ticket.unassigned');
  });

  it('announces a department change and records it', async () => {
    const t = await ticket();

    await agent('PUT', `/escalated/agent/tickets/${t.id}`, { departmentId: sales.id });
    await settle(() => names().includes('ticket.department_changed'));

    expect(names()).toEqual(
      expect.arrayContaining(['ticket.updated', 'ticket.department_changed']),
    );
    const [, data] = delivered().find(([event]) => event === 'ticket.department_changed')!;
    expect(data).toMatchObject({
      ticket: { id: t.id, departmentId: sales.id },
      previousDepartmentId: null,
      newDepartmentId: sales.id,
    });
    const activity = await source
      .getRepository(TicketActivity)
      .findOne({ where: { ticketId: t.id, action: 'department_changed' } });
    expect(activity).not.toBeNull();
  });

  it('announces a priority change', async () => {
    const t = await ticket();
    await agent('PUT', `/escalated/agent/tickets/${t.id}`, { priority: 'urgent' });
    await settle(() => names().includes('ticket.priority_changed'));
    const [, data] = delivered().find(([event]) => event === 'ticket.priority_changed')!;
    expect(data).toMatchObject({ previousPriority: 'medium', newPriority: 'urgent' });
  });

  it('announces tags added and removed, also to legacy tag subscriptions', async () => {
    const tag = await source.getRepository(Tag).save({ name: 'VIP', slug: 'vip' });
    const t = await ticket();

    await agent('PUT', `/escalated/agent/tickets/${t.id}`, { tagIds: [tag.id] });
    await settle(() => names().includes('ticket.tag_added'));
    expect(names()).toContain('ticket.tag_added');
    expect(names(HOOK_LEGACY)).toEqual(['ticket.tag_added']);

    fetchMock.mockClear();
    await agent('PUT', `/escalated/agent/tickets/${t.id}`, { tagIds: [] });
    await settle(() => names().includes('ticket.tag_removed'));
    const [, data] = delivered().find(([event]) => event === 'ticket.tag_removed')!;
    expect(data.tag).toMatchObject({ id: tag.id, name: 'VIP' });
  });

  it('announces resolved, closed and reopened', async () => {
    const t = await ticket();
    const move = async (statusId: number, expected: string) => {
      fetchMock.mockClear();
      await agent('PUT', `/escalated/agent/tickets/${t.id}`, { statusId });
      await settle(() => names().includes(expected));
      return names();
    };

    expect(await move(resolved.id, 'ticket.resolved')).toEqual(
      expect.arrayContaining(['ticket.status_changed', 'ticket.resolved']),
    );
    const afterClose = await move(closed.id, 'ticket.closed');
    expect(afterClose).toContain('ticket.closed');
    expect(afterClose).not.toContain('ticket.resolved');
    const afterReopen = await move(open.id, 'ticket.reopened');
    expect(afterReopen).toContain('ticket.reopened');
    expect(afterReopen).not.toContain('ticket.closed');
  });

  it('sends internal notes as note.created and public replies as reply.created', async () => {
    const t = await ticket();

    await agent('POST', `/escalated/agent/tickets/${t.id}/replies`, {
      body: 'Internal only',
      isInternal: true,
    });
    await settle(() => names().includes('note.created'));
    expect(names()).toContain('note.created');
    expect(names()).not.toContain('reply.created');
    expect(names()).not.toContain('ticket.reply_created');
    expect(names(HOOK_LEGACY)).toEqual(['note.created']);

    fetchMock.mockClear();
    await agent('POST', `/escalated/agent/tickets/${t.id}/replies`, { body: 'Hello' });
    await settle(() => names().includes('reply.created'));
    expect(names()).toContain('reply.created');
    expect(names()).not.toContain('note.created');
    // A subscription stored as `ticket.reply_created` receives `reply.created`.
    expect(names(HOOK_LEGACY)).toEqual(['reply.created']);
  });

  it('stores webhook subscriptions under canonical names', async () => {
    const res = await agent('POST', '/escalated/admin/webhooks', {
      name: 'new',
      url: 'https://1.1.1.1/new',
      events: ['ticket.replied', 'tag.added', 'chat.session_started', 'ticket.created'],
    });
    expect(res.status).toBe(201);
    expect((await res.json()).events).toEqual([
      'reply.created',
      'ticket.tag_added',
      'chat.started',
      'ticket.created',
    ]);
    await source.getRepository(Webhook).update({ name: 'new' }, { isActive: false });
  });

  it('runs workflows stored with a legacy trigger and fires the new triggers', async () => {
    const workflows = source.getRepository(Workflow);
    const legacy = await workflows.save({
      name: 'legacy reply',
      triggerEvent: 'ticket.replied',
      conditions: {},
      actions: [{ type: 'change_priority', value: 'high' }],
      isActive: true,
    });
    const onDepartment = await workflows.save({
      name: 'department',
      triggerEvent: 'ticket.department_changed',
      conditions: {},
      actions: [{ type: 'change_priority', value: 'low' }],
      isActive: true,
    });
    try {
      const t = await ticket();
      await agent('POST', `/escalated/agent/tickets/${t.id}/replies`, { body: 'Hi' });
      await settle(() => false);
      expect(
        await source.getRepository(WorkflowLog).count({ where: { workflow: { id: legacy.id } } }),
      ).toBe(1);
      expect((await source.getRepository(Ticket).findOneBy({ id: t.id }))!.priority).toBe('high');

      // An internal note is not a reply.
      await agent('POST', `/escalated/agent/tickets/${t.id}/replies`, {
        body: 'note',
        isInternal: true,
      });
      await settle(() => false);
      expect(
        await source.getRepository(WorkflowLog).count({ where: { workflow: { id: legacy.id } } }),
      ).toBe(1);

      await agent('PUT', `/escalated/agent/tickets/${t.id}`, { departmentId: billing.id });
      await settle(() => false);
      expect(
        await source
          .getRepository(WorkflowLog)
          .count({ where: { workflow: { id: onDepartment.id } } }),
      ).toBe(1);
      expect((await source.getRepository(Ticket).findOneBy({ id: t.id }))!.priority).toBe('low');
    } finally {
      await workflows.update({ isActive: true }, { isActive: false });
    }
  });

  it('sends the live chat events without the visitor token or email', async () => {
    const started = await publicCall('POST', '/escalated/widget/chat/start', {
      name: 'Visitor',
      email: 'visitor@example.com',
      message: 'Hi',
      ...(await chatProof('visitor@example.com')),
    });
    expect(started.status).toBe(201);
    const { id: token, session_id: sessionId } = await started.json();

    expect((await agent('POST', `/escalated/agent/chat/${sessionId}/accept`)).status).toBe(201);
    expect(
      (
        await agent('POST', `/escalated/agent/chat/${sessionId}/transfer`, {
          agent_id: OTHER_AGENT,
        })
      ).status,
    ).toBe(201);
    await publicCall('POST', `/escalated/widget/chat/${token}/messages`, { body: 'Thanks' });
    expect(
      (await agent('POST', `/escalated/agent/chat/${sessionId}/end`, {}, OTHER_AGENT)).status,
    ).toBe(201);
    await settle(() => names().includes('chat.ended'));

    const chat = delivered().filter(([event]) => event.startsWith('chat.'));
    expect(chat.map(([event]) => event)).toEqual([
      'chat.started',
      'chat.assigned',
      'chat.transferred',
      'chat.message',
      'chat.ended',
    ]);
    expect(chat[1][1].chat).toMatchObject({ session_id: sessionId, agent_id: AGENT });
    expect(chat[2][1].chat).toMatchObject({ from_agent_id: AGENT, to_agent_id: OTHER_AGENT });
    expect(chat[3][1].chat).toMatchObject({ author_type: 'visitor' });
    const raw = JSON.stringify(chat);
    expect(raw).not.toContain('visitorTokenHash');
    expect(raw).not.toContain('visitor@example.com');

    // The transfer reassigned the chat's ticket.
    expect(names()).toContain('ticket.assigned');
  });

  it('refuses a transfer with no target', async () => {
    const started = await publicCall('POST', '/escalated/widget/chat/start', {
      name: 'V',
      email: 'v@example.com',
      ...(await chatProof('v@example.com')),
    });
    const { session_id: sessionId } = await started.json();
    const res = await agent('POST', `/escalated/agent/chat/${sessionId}/transfer`, {});
    expect(res.status).toBe(400);
  });

  it('sends sla.warning once per deadline', async () => {
    const soon = new Date(Date.now() + 10 * 60000);
    const t = await ticket({ firstResponseDueAt: soon, resolutionDueAt: soon } as any);
    const sla = app.get(SlaService);

    expect(await sla.checkWarnings(30)).toBe(2);
    expect(await sla.checkWarnings(30)).toBe(0);
    await settle(() => names().filter((n) => n === 'sla.warning').length === 2);

    const warnings = delivered().filter(([event]) => event === 'sla.warning');
    expect(warnings.map(([, data]) => data.warningType).sort()).toEqual([
      'first_response',
      'resolution',
    ]);
    expect(warnings[0][1]).toMatchObject({ ticket: { id: t.id } });
    expect(warnings[0][1].minutesRemaining).toBeGreaterThanOrEqual(8);
  });

  it('sends ticket.escalated once when an escalation rule matches', async () => {
    const policy = await source.getRepository(SlaPolicy).save({ name: 'P', isActive: true });
    await source.getRepository(EscalationRule).save({
      slaPolicyId: policy.id,
      name: 'Overdue',
      triggerType: 'first_response_breach',
      actions: [{ type: 'set_priority', value: 'urgent' }],
      isActive: true,
    });
    const t = await ticket({
      slaPolicyId: policy.id,
      firstResponseDueAt: new Date(Date.now() - 60000),
    } as any);
    const escalations = app.get(EscalationService);

    await escalations.processEscalations();
    await escalations.processEscalations();
    await settle(() => names().includes('ticket.escalated'));

    const escalated = delivered().filter(([event]) => event === 'ticket.escalated');
    expect(escalated).toHaveLength(1);
    expect(escalated[0][1]).toMatchObject({
      ticket: { id: t.id, priority: 'urgent' },
      reason: 'Overdue',
    });
  });
});
