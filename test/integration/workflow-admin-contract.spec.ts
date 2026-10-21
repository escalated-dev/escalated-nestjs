import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { Department, Tag, Ticket, TicketStatus, Workflow, WorkflowLog } from '../../src/entities';
import { WORKFLOW_TRIGGERS } from '../../src/events/workflow-triggers';

jest.setTimeout(60000);

/**
 * Workflow admin over real HTTP + SQLite, using the request body the shared
 * builder sends (escalated-developer-context
 * `domain-model/workflow-admin-contract.md`), not the engine's own field names.
 */

const guardFor = (role: string): CanActivate => ({
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!String(req.headers['x-role'] ?? '').includes(role)) return false;
    if (req.headers['x-user']) req.user = { id: Number(req.headers['x-user']) };
    return true;
  },
});

const ADMIN = 1;
const AGENT = 21;

// The contract's example body, verbatim.
const EXAMPLE = {
  name: 'Route refunds to billing',
  description: null,
  trigger_event: 'ticket.created',
  conditions: {
    all: [{ field: 'subject', operator: 'contains', value: 'refund' }],
  },
  actions: [
    { type: 'change_priority', value: 'high' },
    { type: 'set_department', value: '4' },
  ],
  is_active: true,
};

describe('workflow admin contract', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let pending: TicketStatus;

  const call = (method: string, path: string, body?: unknown, role = 'agent,admin') =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'x-role': role,
        'x-user': String(role.includes('admin') ? ADMIN : AGENT),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const settle = () => new Promise((r) => setTimeout(r, 150));

  const reset = async () => {
    await source.getRepository(WorkflowLog).clear();
    await source.getRepository(Workflow).clear();
  };

  beforeAll(async () => {
    const moduleRef = await bootEscalatedModule({
      escalated: {
        adminGuard: guardFor('admin'),
        agentGuard: guardFor('agent'),
      },
    });
    source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();

    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
    pending = await statuses.save({ name: 'Pending', slug: 'pending' });
    for (const name of ['Sales', 'Support', 'Returns', 'Billing']) {
      await source.getRepository(Department).save({ name, slug: name.toLowerCase() });
    }
    await source.getRepository(Tag).save({ name: 'VIP', slug: 'vip' });

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(reset);

  it('stores the builder body exactly as sent', async () => {
    const res = await call('POST', '/escalated/admin/workflows', EXAMPLE);
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({
      name: EXAMPLE.name,
      description: null,
      trigger_event: 'ticket.created',
      trigger: 'ticket.created',
      conditions: EXAMPLE.conditions,
      actions: EXAMPLE.actions,
      is_active: true,
      position: 0,
    });

    const stored = await source.getRepository(Workflow).findOneByOrFail({ id: created.id });
    expect(stored.triggerEvent).toBe('ticket.created');
    expect(stored.conditions).toEqual(EXAMPLE.conditions);
    expect(stored.actions).toEqual(EXAMPLE.actions);
  });

  it('runs the stored workflow when its trigger fires', async () => {
    await call('POST', '/escalated/admin/workflows', EXAMPLE);

    const res = await call(
      'POST',
      '/escalated/agent/tickets',
      { subject: 'Please refund my order', description: 'Order 5' },
      'agent',
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    await settle();

    const ticket = await source.getRepository(Ticket).findOneByOrFail({ id });
    expect(ticket.priority).toBe('high');
    expect(ticket.departmentId).toBe(4);

    const logs = await (await call('GET', '/escalated/admin/workflows/logs')).json();
    expect(logs.logs).toHaveLength(1);
    expect(logs.logs[0]).toMatchObject({
      workflow_name: EXAMPLE.name,
      ticket_id: id,
      event: 'ticket.created',
      matched: true,
      actions_executed: 2,
      status: 'success',
    });
    const [listed] = (await (await call('GET', '/escalated/admin/workflows')).json()).workflows;
    expect(listed.trigger_count).toBe(1);
    expect(listed.last_triggered_at).toEqual(expect.any(String));
  });

  it('serves the form options: what fires and what the executor runs', async () => {
    const res = await call('GET', '/escalated/admin/workflows/options');
    expect(res.status).toBe(200);
    const options = await res.json();
    expect(options.trigger_events).toEqual(WORKFLOW_TRIGGERS);
    expect(options.action_types.map((a: { value: string }) => a.value)).toEqual(
      expect.arrayContaining([
        'change_status',
        'change_priority',
        'add_tag',
        'remove_tag',
        'set_department',
        'assign_agent',
        'add_note',
        'insert_canned_reply',
      ]),
    );
    expect(options.operators).toEqual(expect.arrayContaining(['equals', 'is_not_empty']));
  });

  it.each([
    ['name', { ...EXAMPLE, name: '' }],
    ['trigger_event', { ...EXAMPLE, trigger_event: undefined }],
    ['trigger_event', { ...EXAMPLE, trigger_event: 'ticket.exploded' }],
    ['actions', { ...EXAMPLE, actions: [] }],
    ['actions', { ...EXAMPLE, actions: [{ type: 'launch_rocket', value: '1' }] }],
    ['conditions', { ...EXAMPLE, conditions: { all: [], any: [] } }],
    ['conditions', { ...EXAMPLE, conditions: { match: 'all', rules: [] } }],
  ])('refuses an invalid %s with 422', async (field, body) => {
    const res = await call('POST', '/escalated/admin/workflows', body);
    expect(res.status).toBe(422);
    expect((await res.json()).errors[field]).toEqual([expect.any(String)]);
    expect(await source.getRepository(Workflow).count()).toBe(0);
  });

  it('treats omitted conditions as matching every ticket', async () => {
    const { conditions: _omit, ...body } = EXAMPLE;
    const res = await call('POST', '/escalated/admin/workflows', body);
    expect(res.status).toBe(201);
    expect((await res.json()).conditions).toEqual({ all: [] });
  });

  it('stores a legacy trigger name as its canonical name', async () => {
    const res = await call('POST', '/escalated/admin/workflows', {
      ...EXAMPLE,
      trigger_event: 'ticket.replied',
    });
    expect(res.status).toBe(201);
    expect((await res.json()).trigger_event).toBe('reply.created');
  });

  it('updates, toggles, reorders and deletes', async () => {
    const first = await (await call('POST', '/escalated/admin/workflows', EXAMPLE)).json();
    const second = await (
      await call('POST', '/escalated/admin/workflows', { ...EXAMPLE, name: 'Second' })
    ).json();
    expect(second.position).toBe(1);

    const updated = await call('PUT', `/escalated/admin/workflows/${first.id}`, {
      ...EXAMPLE,
      name: 'Renamed',
      trigger_event: 'ticket.updated',
      conditions: { any: [{ field: 'priority', operator: 'equals', value: 'low' }] },
      is_active: false,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      name: 'Renamed',
      trigger_event: 'ticket.updated',
      conditions: { any: [{ field: 'priority', operator: 'equals', value: 'low' }] },
      is_active: false,
    });
    expect((await call('PUT', `/escalated/admin/workflows/${first.id}`, {})).status).toBe(422);

    const toggled = await call('POST', `/escalated/admin/workflows/${first.id}/toggle`);
    expect(toggled.status).toBe(200);
    expect((await toggled.json()).is_active).toBe(true);

    const reordered = await call('POST', '/escalated/admin/workflows/reorder', {
      workflow_ids: [second.id, first.id],
    });
    expect(reordered.status).toBe(200);
    expect((await reordered.json()).workflows.map((w: { id: number }) => w.id)).toEqual([
      second.id,
      first.id,
    ]);

    expect((await call('DELETE', `/escalated/admin/workflows/${first.id}`)).status).toBe(204);
    expect((await call('GET', `/escalated/admin/workflows/${first.id}`)).status).toBe(404);
  });

  it('keeps the admin routes behind the admin guard', async () => {
    expect((await call('GET', '/escalated/admin/workflows', undefined, 'agent')).status).toBe(403);
    expect((await call('POST', '/escalated/admin/workflows', EXAMPLE, 'agent')).status).toBe(403);
  });

  describe('condition fields the engine used to skip', () => {
    const ticket = () =>
      source.getRepository(Ticket).save({
        referenceNumber: `WF-${Math.random().toString(36).slice(2, 8)}`,
        subject: 'Hello',
        description: 'd',
        requesterId: 5,
        statusId: open.id,
        priority: 'medium',
      } as Partial<Ticket>);

    const workflowOn = (conditions: unknown) =>
      call('POST', '/escalated/admin/workflows', {
        name: 'cond',
        trigger_event: 'ticket.updated',
        conditions,
        actions: [{ type: 'change_priority', value: 'urgent' }],
      });

    const priorityAfter = async (id: number, change: Record<string, unknown>) => {
      await call('PUT', `/escalated/agent/tickets/${id}`, change, 'agent');
      await settle();
      return (await source.getRepository(Ticket).findOneByOrFail({ id })).priority;
    };

    it('evaluates status as the status slug', async () => {
      await workflowOn({ all: [{ field: 'status', operator: 'equals', value: 'pending' }] });
      const t = await ticket();
      expect(await priorityAfter(t.id, { subject: 'still open' })).toBe('medium');
      expect(await priorityAfter(t.id, { statusId: pending.id })).toBe('urgent');
    });

    it('evaluates assigned_to', async () => {
      await workflowOn({ all: [{ field: 'assigned_to', operator: 'equals', value: '21' }] });
      const t = await ticket();
      expect(await priorityAfter(t.id, { assigneeId: 22 })).toBe('medium');
      expect(await priorityAfter(t.id, { assigneeId: 21 })).toBe('urgent');
    });

    it('evaluates tags by name', async () => {
      await workflowOn({ all: [{ field: 'tags', operator: 'contains', value: 'VIP' }] });
      const vip = await source.getRepository(Tag).findOneByOrFail({ slug: 'vip' });
      const t = await ticket();
      expect(await priorityAfter(t.id, { subject: 'no tags yet' })).toBe('medium');
      expect(await priorityAfter(t.id, { tagIds: [vip.id] })).toBe('urgent');
    });

    it('adds a tag by the name the builder sends', async () => {
      await call('POST', '/escalated/admin/workflows', {
        name: 'tagger',
        trigger_event: 'ticket.updated',
        conditions: { all: [] },
        actions: [{ type: 'add_tag', value: 'VIP' }],
      });
      const t = await ticket();
      await call('PUT', `/escalated/agent/tickets/${t.id}`, { subject: 'tag me' }, 'agent');
      await settle();
      const tagged = await source
        .getRepository(Ticket)
        .findOneOrFail({ where: { id: t.id }, relations: { tags: true } });
      expect(tagged.tags.map((tag) => tag.name)).toEqual(['VIP']);
    });
  });
});
