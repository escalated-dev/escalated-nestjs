import { INestApplication } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import {
  AgentProfile,
  Department,
  Reply,
  SavedView,
  Ticket,
  TicketStatus,
} from '../../src/entities';
import { AgentInboxService } from '../../src/ui/agent-inbox.service';
import manifest from '../fixtures/escalated-pages.json';
import { AGENT, bootUi, cookieFrom, CUSTOMER, headersFor, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * The agent panel's optional `inbox` and `queue` props, and the list filters
 * its rail, views and stat strip link to (shared frontend docs/agent-panel.md),
 * as escalated-laravel sends them.
 *
 * Every number must be what the agent gets by opening the list it labels, so
 * the tests check counts against the list and against visibility.
 */

const OTHER_AGENT = 22;
const BUILT_IN_VIEW_IDS = [
  'urgent',
  'sla_at_risk',
  'waiting_on_me',
  'waiting_on_customer',
  'recently_updated',
];
const INDEX = '/escalated/agent/tickets';
const v1 = { headers: { 'x-inertia-version': 'v1' } };
const minutes = (n: number) => new Date(Date.now() + n * 60 * 1000);

type Statuses = Record<string, TicketStatus>;

async function seedStatuses(source: DataSource): Promise<Statuses> {
  const repo = source.getRepository(TicketStatus);
  const statuses: Statuses = {};
  for (const [slug, closed] of [
    ['open', false],
    ['waiting_on_customer', false],
    ['waiting_on_agent', false],
    ['resolved', true],
    ['closed', true],
  ] as const) {
    statuses[slug] = await repo.save({
      name: slug,
      slug,
      isClosed: closed,
      isDefault: slug === 'open',
    });
  }
  return statuses;
}

function ticketMaker(source: DataSource, statuses: Statuses) {
  let seq = 0;
  return async (overrides: Partial<Ticket> & { statusSlug?: string } = {}) => {
    seq += 1;
    const { statusSlug, ...rest } = overrides;
    const repo = source.getRepository(Ticket);
    return repo.save(
      repo.create({
        referenceNumber: `INB-${seq}-${Date.now()}`,
        subject: `Ticket ${seq}`,
        description: 'Something broke',
        priority: 'low',
        channel: 'web',
        statusId: statuses[statusSlug ?? 'open'].id,
        requesterId: CUSTOMER,
        ...rest,
      }),
    );
  };
}

describe('agent inbox props (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let statuses: Statuses;
  let make: ReturnType<typeof ticketMaker>;
  let tickets: Repository<Ticket>;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: { enabled: true, version: 'v1', agentInbox: { cacheSeconds: 0 } },
    }));
    statuses = await seedStatuses(source);
    make = ticketMaker(source, statuses);
    tickets = source.getRepository(Ticket);
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await source.getRepository(Reply).clear();
    await source.getRepository(SavedView).clear();
    await tickets.createQueryBuilder().delete().execute();
  });

  it('sends inbox counts, built-in views, stats and the queue on the ticket list', async () => {
    await make({ assigneeId: AGENT, priority: 'urgent' });
    await make({ assigneeId: AGENT, statusSlug: 'waiting_on_customer' });
    await make({ assigneeId: AGENT, statusSlug: 'resolved', resolvedAt: new Date() });
    await make({ assigneeId: AGENT, statusSlug: 'resolved', resolvedAt: minutes(-2 * 24 * 60) });
    await make({ assigneeId: AGENT, snoozedUntil: minutes(24 * 60) });
    await make();
    await make({ statusSlug: 'closed' });
    await make({ assigneeId: OTHER_AGENT });

    const result = await page(base, INDEX, v1);
    expect(result.component).toBe('Escalated/Agent/TicketIndex');

    const inbox = result.props.inbox;
    expect(Object.keys(inbox)).toEqual(['counts', 'unread', 'views', 'stats']);
    // Unresolved, unsnoozed tickets in each queue.
    expect(inbox.counts).toEqual({ mine: 2, unassigned: 1, all: 4 });
    expect(inbox.views.map((v: any) => v.id)).toEqual(BUILT_IN_VIEW_IDS);
    expect(Object.keys(inbox.views[0])).toEqual(['id', 'name', 'count', 'filters']);
    expect(inbox.views[0]).toEqual({
      id: 'urgent',
      name: 'Urgent',
      count: 1,
      filters: { priority: 'urgent', open: 1 },
    });
    expect(Object.keys(inbox.stats)).toEqual(['open', 'urgent', 'sla_at_risk', 'resolved_today']);
    // The "all" queue: three tickets with status open, one urgent, one resolved today.
    expect(inbox.stats).toEqual({ open: 3, urgent: 1, sla_at_risk: 0, resolved_today: 1 });
    expect(result.props.queue).toEqual({ key: 'all', title: 'All tickets' });

    const views = Object.fromEntries(inbox.views.map((v: any) => [v.id, v]));
    expect(views.waiting_on_customer.count).toBe(1);
    expect(views.waiting_on_customer.filters).toEqual({
      assigned_to: AGENT,
      status: 'waiting_on_customer',
    });
    expect(views.waiting_on_me.filters).toEqual({
      assigned_to: AGENT,
      status: 'waiting_on_agent',
    });
    expect(views.sla_at_risk.filters).toEqual({ sla_at_risk: 1 });
    expect(views.recently_updated.filters).toEqual({
      open: 1,
      updated_within_hours: 24,
      sort_by: 'updated_at',
    });
    expect(views.recently_updated.count).toBe(4);
  });

  it.each([
    ['mine', '?assigned_to={me}', 'mine', 'My inbox', [1, 1, 0, 1]],
    ['mine, by alias', '?assigned=me', 'mine', 'My inbox', [1, 1, 0, 1]],
    [
      'mine with a stat tile on',
      '?assigned_to={me}&priority=urgent',
      'mine',
      'My inbox',
      [1, 1, 0, 1],
    ],
    ['unassigned', '?unassigned=1', 'unassigned', 'Unassigned', [2, 1, 0, 1]],
    ['all', '', 'all', 'All tickets', [3, 2, 0, 2]],
    [
      'a built-in view by its filters',
      '?priority=urgent&open=1',
      'view:urgent',
      'Urgent',
      [2, 2, 0, 0],
    ],
    ['a built-in view by id', '?view=urgent', 'view:urgent', 'Urgent', [2, 2, 0, 0]],
  ])('names and scopes the queue from the list query: %s', async (_, query, key, title, stats) => {
    await make({ assigneeId: AGENT, priority: 'urgent' });
    await make({ assigneeId: AGENT, statusSlug: 'resolved', resolvedAt: new Date() });
    await make();
    await make({ statusSlug: 'resolved', resolvedAt: new Date() });
    await make({ priority: 'urgent' });

    const result = await page(base, INDEX + query.replace('{me}', String(AGENT)), v1);

    expect(result.props.queue).toEqual({ key, title });
    const [open, urgent, slaAtRisk, resolvedToday] = stats;
    expect(result.props.inbox.stats).toEqual({
      open,
      urgent,
      sla_at_risk: slaAtRisk,
      resolved_today: resolvedToday,
    });
  });

  it("lists the agent's own and shared saved views with counts, but not other agents' private views", async () => {
    const views = source.getRepository(SavedView);
    const mine = await views.save({
      userId: AGENT,
      name: 'High priority',
      filters: { priority: 'high' },
      sortOrder: 1,
    });
    const shared = await views.save({
      userId: OTHER_AGENT,
      name: 'Waiting',
      filters: { status: 'waiting_on_agent' },
      isShared: true,
      sortOrder: 2,
    });
    await views.save({
      userId: OTHER_AGENT,
      name: 'Private',
      filters: { priority: 'low' },
      sortOrder: 0,
    });

    await make({ priority: 'high' });
    await make({ priority: 'high' });
    await make({ priority: 'high', statusSlug: 'closed' });
    await make({ statusSlug: 'waiting_on_agent' });

    const result = await page(base, INDEX, v1);
    const saved = result.props.inbox.views.filter(
      (view: any) => !BUILT_IN_VIEW_IDS.includes(view.id),
    );

    expect(saved).toEqual([
      { id: mine.id, name: 'High priority', count: 2, filters: { priority: 'high' } },
      { id: shared.id, name: 'Waiting', count: 1, filters: { status: 'waiting_on_agent' } },
    ]);
  });

  it.each(['id', 'filters'])(
    'selects a saved view as the queue, by %s, and filters the list with it',
    async (by) => {
      const view = await source.getRepository(SavedView).save({
        userId: AGENT,
        name: 'High priority',
        filters: { priority: 'high' },
        sortOrder: 1,
      });
      const high = await make({ priority: 'high' });
      await make({ priority: 'low' });

      const query = by === 'id' ? `?view=${view.id}` : '?priority=high';
      const result = await page(base, INDEX + query, v1);

      expect(result.props.queue).toEqual({ key: `view:${view.id}`, title: 'High priority' });
      expect(result.props.tickets.data.map((t: any) => t.id)).toEqual([high.id]);
    },
  );

  it("does not let an agent select another agent's private view", async () => {
    const hidden = await source.getRepository(SavedView).save({
      userId: OTHER_AGENT,
      name: 'Private',
      filters: { priority: 'high' },
      sortOrder: 1,
    });
    await make({ priority: 'high' });
    await make({ priority: 'low' });

    const result = await page(base, `${INDEX}?view=${hidden.id}`, v1);

    expect(result.props.queue).toEqual({ key: 'all', title: 'All tickets' });
    expect(result.props.tickets.total).toBe(2);
  });

  it('gives every built-in view the count its own list shows', async () => {
    await make({ assigneeId: AGENT, priority: 'urgent' });
    await make({ priority: 'urgent', statusSlug: 'closed' });
    await make({ assigneeId: AGENT, statusSlug: 'waiting_on_agent' });
    await make({ assigneeId: AGENT, statusSlug: 'waiting_on_customer' });
    await make({ slaFirstResponseBreached: true });
    await make({ resolutionDueAt: minutes(30) });
    const stale = await make();
    await tickets
      .createQueryBuilder()
      .update()
      .set({ updatedAt: () => "'2000-01-01 00:00:00'" })
      .where('id = :id', { id: stale.id })
      .execute();

    const views = (await page(base, INDEX, v1)).props.inbox.views;

    for (const view of views) {
      const query = new URLSearchParams(
        Object.entries(view.filters).map(([k, v]) => [k, String(v)]),
      ).toString();
      const total = (await page(base, `${INDEX}?${query}`, v1)).props.tickets.total;
      expect([view.id, view.count]).toEqual([view.id, total]);
    }

    expect(Object.fromEntries(views.map((v: any) => [v.id, v.count]))).toEqual({
      urgent: 1,
      sla_at_risk: 2,
      waiting_on_me: 1,
      waiting_on_customer: 1,
      recently_updated: 5,
    });
  });

  it('filters the list to tickets whose SLA is breached or due within the hour', async () => {
    const breached = await make({ slaResolutionBreached: true });
    const responseDue = await make({ firstResponseDueAt: minutes(20) });
    const resolutionDue = await make({ resolutionDueAt: minutes(50) });
    await make({ firstResponseDueAt: minutes(20), firstRespondedAt: minutes(-1) });
    await make({ resolutionDueAt: minutes(180) });
    await make({ slaResolutionBreached: true, statusSlug: 'resolved', resolvedAt: new Date() });
    await make();

    const result = await page(base, `${INDEX}?sla_at_risk=1`, v1);
    const ids = result.props.tickets.data
      .map((t: any) => t.id)
      .sort((a: number, b: number) => a - b);

    expect(ids).toEqual([breached.id, responseDue.id, resolutionDue.id]);
    expect(result.props.inbox.stats.sla_at_risk).toBe(3);
  });

  it('filters the list to tickets resolved today', async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = await make({
      statusSlug: 'resolved',
      resolvedAt: new Date(startOfToday.getTime() + 60 * 1000),
    });
    await make({
      statusSlug: 'resolved',
      resolvedAt: new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000),
    });
    await make();

    const result = await page(base, `${INDEX}?status=resolved&resolved_today=1`, v1);

    expect(result.props.tickets.data.map((t: any) => t.id)).toEqual([today.id]);
  });

  it('filters the list to tickets updated within the given hours', async () => {
    const fresh = await make();
    const stale = await make();
    await tickets
      .createQueryBuilder()
      .update()
      .set({ updatedAt: () => "'2000-01-01 00:00:00'" })
      .where('id = :id', { id: stale.id })
      .execute();

    const result = await page(base, `${INDEX}?updated_within_hours=24`, v1);

    expect(result.props.tickets.data.map((t: any) => t.id)).toEqual([fresh.id]);
  });

  it('filters the list to unresolved tickets with open=1', async () => {
    const open = await make();
    await make({ statusSlug: 'resolved', resolvedAt: new Date() });
    await make({ statusSlug: 'closed' });

    const result = await page(base, `${INDEX}?open=1`, v1);

    expect(result.props.tickets.data.map((t: any) => t.id)).toEqual([open.id]);
  });

  it('filters the list to the agent with assigned=me', async () => {
    const mine = await make({ assigneeId: AGENT });
    await make({ assigneeId: OTHER_AGENT });
    await make();

    const result = await page(base, `${INDEX}?assigned=me`, v1);

    expect(result.props.tickets.data.map((t: any) => t.id)).toEqual([mine.id]);
  });

  it.each([
    [{ sla_at_risk: 'soon' }],
    [{ resolved_today: 'maybe' }],
    [{ open: 'perhaps' }],
    [{ updated_within_hours: '0' }],
    [{ updated_within_hours: 'a day' }],
    [{ updated_within_hours: '9000' }],
  ])('sends malformed values for the new filters back with errors: %j', async (query) => {
    // As escalated-laravel's $request->validate() on a page visit: a redirect
    // back with the errors for the next page's `errors` prop, never a raw 422
    // (which Inertia shows as an error modal).
    const from = `${INDEX}?assigned=me`;
    const res = await inertiaFetch(base, `${INDEX}?${new URLSearchParams(query)}`, {
      headers: { ...v1.headers, referer: `${base}${from}` },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(from);
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/^escalated_flash=/);
    const next = await page(base, from, { headers: { ...v1.headers, cookie } });
    expect(Object.keys(next.props.errors)).toEqual(Object.keys(query));
  });

  it('sends a malformed filter on a browser visit with no referer back to the list', async () => {
    const res = await fetch(`${base}${INDEX}?sla_at_risk=soon`, {
      headers: { accept: 'text/html', ...headersFor(base, v1) },
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(INDEX);
  });

  it('previews the latest customer-visible message, never an internal note', async () => {
    const ticket = await make();
    const replies = source.getRepository(Reply);
    await replies.save({
      ticketId: ticket.id,
      userId: AGENT,
      body: 'Customer-visible answer',
      type: 'reply',
      createdAt: minutes(-5),
    });
    await replies.save({
      ticketId: ticket.id,
      userId: AGENT,
      body: 'Secret internal note',
      type: 'note',
      isInternal: true,
      createdAt: new Date(),
    });

    const row = (await page(base, INDEX, v1)).props.tickets.data[0];

    expect(row.latest_reply.body).toBe('Customer-visible answer');
    // Agent replies are not customer activity.
    expect(row.is_unread).toBe(false);
    expect(row.requester_online).toBe(false);
  });

  it('sends inbox and the queue the agent last opened on the ticket page', async () => {
    const ticket = await make({ assigneeId: AGENT });
    await make();
    const show = `${INDEX}/${ticket.referenceNumber}`;

    let result = await page(base, show, v1);
    expect(result.component).toBe('Escalated/Agent/TicketShow');
    expect(result.props.queue).toEqual({ key: 'all', title: 'All tickets' });
    expect(result.props.inbox.counts).toEqual({ mine: 1, unassigned: 1, all: 2 });
    expect(Object.keys(result.props.inbox)).toEqual(['counts', 'unread', 'views', 'stats']);

    const list = await inertiaFetch(base, `${INDEX}?assigned_to=${AGENT}`, v1);
    expect(list.status).toBe(200);
    const cookie = cookieFrom(list);
    expect(cookie).toBe('escalated_agent_queue=mine');

    result = await page(base, show, { headers: { ...v1.headers, cookie } });
    expect(result.props.queue).toEqual({ key: 'mine', title: 'My inbox' });
    expect(result.props.inbox.stats).toEqual({
      open: 1,
      urgent: 0,
      sla_at_risk: 0,
      resolved_today: 0,
    });
  });

  it('recalls a remembered view only while the agent may still see it', async () => {
    const ticket = await make();
    const show = `${INDEX}/${ticket.referenceNumber}`;
    const hidden = await source.getRepository(SavedView).save({
      userId: OTHER_AGENT,
      name: 'Private',
      filters: { priority: 'high' },
      sortOrder: 1,
    });

    const viaView = await page(base, show, {
      headers: { ...v1.headers, cookie: `escalated_agent_queue=view%3A${hidden.id}` },
    });
    const viaJunk = await page(base, show, {
      headers: { ...v1.headers, cookie: 'escalated_agent_queue=somebody-else' },
    });
    const viaBuiltIn = await page(base, show, {
      headers: { ...v1.headers, cookie: 'escalated_agent_queue=view%3Aurgent' },
    });

    expect(viaView.props.queue).toEqual({ key: 'all', title: 'All tickets' });
    expect(viaJunk.props.queue).toEqual({ key: 'all', title: 'All tickets' });
    expect(viaBuiltIn.props.queue).toEqual({ key: 'view:urgent', title: 'Urgent' });
  });

  it('caches the inbox per agent for the configured seconds', async () => {
    const inbox = app.get(AgentInboxService) as any;
    inbox.options.ui.agentInbox.cacheSeconds = 30;
    const now = Date.now();
    try {
      await make({ assigneeId: AGENT });
      expect((await page(base, INDEX, v1)).props.inbox.counts.mine).toBe(1);

      await make({ assigneeId: AGENT });
      await make({ assigneeId: OTHER_AGENT });

      expect((await page(base, INDEX, v1)).props.inbox.counts.mine).toBe(1);
      const other = await page(base, INDEX, {
        headers: { ...v1.headers, 'x-user': String(OTHER_AGENT) },
      });
      expect(other.props.inbox.counts.mine).toBe(1);

      jest.spyOn(Date, 'now').mockReturnValue(now + 31_000);
      expect((await page(base, INDEX, v1)).props.inbox.counts.mine).toBe(2);
    } finally {
      jest.restoreAllMocks();
      inbox.options.ui.agentInbox.cacheSeconds = 0;
      inbox.cache.clear();
    }
  });

  it.each(['Escalated/Agent/TicketIndex', 'Escalated/Agent/TicketShow'])(
    'sends %s every prop it declares, and nothing it does not',
    async (component) => {
      const ticket = await make();
      const path = component.endsWith('Index') ? INDEX : `${INDEX}/${ticket.referenceNumber}`;
      const result = await page(base, path, v1);

      expect(result.component).toBe(component);
      const declared = [...(manifest as any).props[component].props].sort();
      const shared = ['errors', 'auth', 'flash', 'escalated', 'ziggy'];
      // `custom_fields` and `is_snoozed` ride along for Admin/Tickets/Show's screen data.
      const extra = ['custom_fields', 'is_snoozed'];
      const sent = Object.keys(result.props)
        .filter((key) => !shared.includes(key) && !extra.includes(key))
        .sort();
      expect(sent).toEqual(declared);
    },
  );
});

describe('agent inbox props under department visibility', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: { enabled: true, version: 'v1', agentInbox: { cacheSeconds: 0 } },
      visibility: 'department',
      ticketAccess: { resolveUser: async (id: any) => ({ id, isAgent: true, isAdmin: false }) },
    } as any));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('counts only tickets the agent may see', async () => {
    const statuses = await seedStatuses(source);
    const make = ticketMaker(source, statuses);
    const departments = source.getRepository(Department);
    const support = await departments.save({ name: 'Support', slug: 'support' });
    const billing = await departments.save({ name: 'Billing', slug: 'billing' });
    await source.getRepository(AgentProfile).save({ userId: AGENT, departments: [support] });

    await make({ departmentId: support.id, assigneeId: AGENT, priority: 'urgent' });
    await make({ departmentId: support.id });
    await make({ departmentId: billing.id });
    await make({ departmentId: billing.id, priority: 'urgent' });
    await make({ departmentId: billing.id, statusSlug: 'resolved', resolvedAt: new Date() });

    const inbox = (await page(base, INDEX, v1)).props.inbox;

    expect(inbox.counts).toEqual({ mine: 1, unassigned: 1, all: 2 });
    expect(inbox.stats).toEqual({ open: 2, urgent: 1, sla_at_risk: 0, resolved_today: 0 });
    expect(inbox.views.find((v: any) => v.id === 'urgent').count).toBe(1);
  });
});
