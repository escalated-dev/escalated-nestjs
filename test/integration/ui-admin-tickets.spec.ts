import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AgentProfile,
  CannedResponse,
  Department,
  Macro,
  Reply,
  SavedView,
  Tag,
  Ticket,
  TicketFollower,
  TicketStatus,
} from '../../src/entities';
import {
  ADMIN,
  AGENT,
  apiFetch,
  bootUi,
  cookieFrom,
  CUSTOMER,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The admin ticket screens over real HTTP and SQLite, with escalated-laravel's
 * Admin\TicketController, BulkActionController and SavedViewController as the
 * contract: `Escalated/Admin/Tickets/Index` and `Show`, every action the
 * screen posts, bulk actions and the saved views sidebar.
 */
describe('admin ticket screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let resolved: TicketStatus;
  let billing: Department;
  let vip: Tag;
  let urgent: Tag;
  let seq = 0;

  const asAdmin = { as: 'admin' as const };

  const makeTicket = async (overrides: Partial<Ticket> = {}) => {
    seq += 1;
    return source.getRepository(Ticket).save(
      source.getRepository(Ticket).create({
        referenceNumber: `ADM-${1000 + seq}`,
        subject: `Ticket ${seq}`,
        description: 'Something broke',
        priority: 'medium',
        channel: 'web',
        statusId: open.id,
        requesterId: CUSTOMER,
        guestAccessToken: `admin-token-${seq}`,
        ...overrides,
      }),
    );
  };

  const reload = (ticket: Ticket) =>
    source.getRepository(Ticket).findOne({ where: { id: ticket.id }, relations: { tags: true } });

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: {
        enabled: true,
        resolveUsers: (ids) =>
          ids.map((id) => ({ id, name: `Host user ${id}`, email: `u${id}@example.com` })),
      },
    }));
    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
    resolved = await statuses.save({ name: 'Resolved', slug: 'resolved', isClosed: true });
    billing = await source.getRepository(Department).save({ name: 'Billing', slug: 'billing' });
    vip = await source.getRepository(Tag).save({ name: 'VIP', slug: 'vip', color: '#f00' });
    urgent = await source.getRepository(Tag).save({ name: 'Urgent', slug: 'urgent' });
    await source.getRepository(AgentProfile).save([
      { userId: AGENT, displayName: 'Agent Smith', isActive: true },
      { userId: 99, displayName: 'Gone', isActive: false },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the admin ticket screens behind the admin guard', async () => {
    const res = await inertiaFetch(base, '/escalated/admin/tickets', { as: 'agent' });
    expect(res.status).toBe(403);
  });

  describe('Escalated/Admin/Tickets/Index', () => {
    it('sends the paginated tickets, filters, departments, tags, agents and saved views', async () => {
      const filed = await makeTicket({ subject: 'Refund please', departmentId: billing.id });
      await makeTicket({ subject: 'Other' });
      const views = source.getRepository(SavedView);
      const mine = await views.save({ name: 'Mine', userId: ADMIN, filters: { status: 'open' } });
      const shared = await views.save({
        name: 'Team',
        userId: AGENT,
        filters: { priority: 'high' },
        isShared: true,
        sortOrder: 2,
      });
      await views.save({ name: 'Private to agent', userId: AGENT, filters: {} });

      const result = await page(
        base,
        `/escalated/admin/tickets?department_id=${billing.id}&search=Refund`,
        asAdmin,
      );
      expect(result.component).toBe('Escalated/Admin/Tickets/Index');
      expectManifestProps(result);
      const { props } = result;
      expect(props.tickets).toMatchObject({ current_page: 1, per_page: 25, total: 1 });
      expect(props.tickets.data[0]).toMatchObject({
        id: filed.id,
        reference: filed.referenceNumber,
        subject: 'Refund please',
        status: 'open',
        department: { id: billing.id, name: 'Billing' },
      });
      expect(props.filters).toEqual({ department_id: String(billing.id), search: 'Refund' });
      expect(props.departments).toContainEqual({ id: billing.id, name: 'Billing' });
      expect(props.tags).toContainEqual({ id: vip.id, name: 'VIP', color: '#f00' });
      expect(props.agents).toEqual([
        { id: AGENT, name: `Host user ${AGENT}`, email: `u${AGENT}@example.com` },
      ]);
      expect(props.savedViews.map((v: any) => v.id)).toEqual([mine.id, shared.id]);
      expect(props.savedViews[1]).toMatchObject({
        name: 'Team',
        filters: { priority: 'high' },
        is_shared: true,
        is_default: false,
        user_id: AGENT,
      });
    });
  });

  describe('Escalated/Admin/Tickets/Show', () => {
    it('opens a ticket by reference with everything the screen reads', async () => {
      const ticket = await makeTicket({
        departmentId: billing.id,
        snoozedUntil: new Date(Date.now() + 3600_000),
      });
      await source
        .getRepository(Reply)
        .save({ ticketId: ticket.id, userId: CUSTOMER, body: 'Help', type: 'reply' });
      await source.getRepository(CannedResponse).save({
        title: 'Hello',
        shortCode: 'hi',
        content: 'Hello there',
        scope: 'shared',
      });
      await source
        .getRepository(Macro)
        .save({ name: 'Wrap up', description: 'Close', actions: [], scope: 'shared' });

      const result = await page(
        base,
        `/escalated/admin/tickets/${ticket.referenceNumber}`,
        asAdmin,
      );
      expect(result.component).toBe('Escalated/Admin/Tickets/Show');
      expectManifestProps(result);
      const { props } = result;
      expect(props.ticket).toMatchObject({
        id: ticket.id,
        reference: ticket.referenceNumber,
        subject: ticket.subject,
        description: 'Something broke',
        status: 'open',
        priority: 'medium',
        is_snoozed: true,
        snoozed_until: expect.any(String),
        pinned_notes: [],
        attachments: [],
        requester: expect.objectContaining({ id: CUSTOMER }),
        department: { id: billing.id, name: 'Billing' },
      });
      expect(props.ticket.replies.map((r: any) => r.body)).toEqual(['Help']);
      expect(props.is_snoozed).toBe(true);
      expect(props.agents).toContainEqual(expect.objectContaining({ id: AGENT }));
      expect(props.cannedResponses).toContainEqual(
        expect.objectContaining({ title: 'Hello', body: 'Hello there' }),
      );
      expect(props.macros).toContainEqual(expect.objectContaining({ name: 'Wrap up' }));
      expect(props.is_following).toBe(false);
      expect(props.followers_count).toBe(0);
    });

    it('opens a ticket by numeric id too', async () => {
      const ticket = await makeTicket();
      const result = await page(base, `/escalated/admin/tickets/${ticket.id}`, asAdmin);
      expect(result.props.ticket.reference).toBe(ticket.referenceNumber);
      expect(result.props.is_snoozed).toBe(false);
    });
  });

  describe('ticket actions the screen posts', () => {
    const act = async (ticket: Ticket, action: string, body: unknown) => {
      const show = `/escalated/admin/tickets/${ticket.referenceNumber}`;
      const res = await inertiaFetch(base, `${show}/${action}`, {
        ...asAdmin,
        body,
        headers: { referer: `${base}${show}` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(show);
      return (await reload(ticket))!;
    };

    it('replies and adds notes as the admin', async () => {
      const ticket = await makeTicket();
      await act(ticket, 'reply', { body: 'On it' });
      await act(ticket, 'note', { body: 'Internal' });
      const replies = await source.getRepository(Reply).find({
        where: { ticketId: ticket.id },
        order: { id: 'ASC' },
      });
      expect(replies.map((r) => [r.body, r.isInternal, r.userId])).toEqual([
        ['On it', false, ADMIN],
        ['Internal', true, ADMIN],
      ]);
    });

    it('assigns, changes status, priority, tags and department', async () => {
      const ticket = await makeTicket();
      expect((await act(ticket, 'assign', { agent_id: AGENT })).assigneeId).toBe(AGENT);
      expect((await act(ticket, 'status', { status: 'resolved' })).statusId).toBe(resolved.id);
      expect((await act(ticket, 'priority', { priority: 'urgent' })).priority).toBe('urgent');
      const tagged = await act(ticket, 'tags', { tag_ids: [vip.id] });
      expect(tagged.tags.map((t) => t.id)).toEqual([vip.id]);
      expect((await act(ticket, 'department', { department_id: billing.id })).departmentId).toBe(
        billing.id,
      );
    });

    it('follows, applies a macro, snoozes and unsnoozes', async () => {
      const ticket = await makeTicket();
      await act(ticket, 'follow', {});
      expect(
        await source.getRepository(TicketFollower).countBy({ ticketId: ticket.id, userId: ADMIN }),
      ).toBe(1);

      const macro = await source.getRepository(Macro).save({
        name: 'Bump',
        actions: [{ type: 'set_priority', value: 'high' }],
        scope: 'shared',
      });
      expect((await act(ticket, 'macro', { macro_id: macro.id })).priority).toBe('high');

      const until = new Date(Date.now() + 2 * 3600_000);
      const snoozed = await act(ticket, 'snooze', { snoozed_until: until.toISOString() });
      expect(new Date(snoozed.snoozedUntil).getTime()).toBe(until.getTime());
      expect((await act(ticket, 'unsnooze', {})).snoozedUntil).toBeNull();
    });

    it('sends a snooze time in the past back with a field error', async () => {
      const ticket = await makeTicket();
      const show = `/escalated/admin/tickets/${ticket.referenceNumber}`;
      const res = await inertiaFetch(base, `${show}/snooze`, {
        ...asAdmin,
        body: { snoozed_until: '2001-01-01T00:00:00Z' },
        headers: { referer: `${base}${show}` },
      });
      expect(res.status).toBe(303);
      const next = await page(base, show, { ...asAdmin, headers: { cookie: cookieFrom(res) } });
      expect(Object.keys(next.props.errors)).toEqual(['snoozed_until']);
    });
  });

  describe('bulk actions', () => {
    const bulk = (body: unknown) =>
      inertiaFetch(base, '/escalated/admin/tickets/bulk', {
        ...asAdmin,
        body,
        headers: { referer: `${base}/escalated/admin/tickets` },
      });

    it('changes status, priority, assignee, department and adds tags on each ticket', async () => {
      const a = await makeTicket();
      const b = await makeTicket();
      await source.getRepository(Ticket).save({ ...a, tags: [urgent] });
      const ids = [a.id, b.id];

      const res = await bulk({ ticket_ids: ids, action: 'status', value: 'resolved' });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/tickets');
      const next = await page(base, '/escalated/admin/tickets', {
        ...asAdmin,
        headers: { cookie: cookieFrom(res) },
      });
      expect(next.props.flash.success).toBe('2 ticket(s) updated.');

      await bulk({ ticket_ids: ids, action: 'priority', value: 'low' });
      await bulk({ ticket_ids: ids, action: 'assign', value: AGENT });
      await bulk({ ticket_ids: ids, action: 'department', value: billing.id });
      await bulk({ ticket_ids: ids, action: 'tags', value: [vip.id] });

      const first = (await reload(a))!;
      expect(first).toMatchObject({
        statusId: resolved.id,
        priority: 'low',
        assigneeId: AGENT,
        departmentId: billing.id,
      });
      expect(first.tags.map((t) => t.id).sort()).toEqual([vip.id, urgent.id].sort());
      expect((await reload(b))!.tags.map((t) => t.id)).toEqual([vip.id]);
    });

    it('deletes tickets', async () => {
      const doomed = await makeTicket();
      await bulk({ ticket_ids: [doomed.id], action: 'delete' });
      expect(await reload(doomed)).toBeNull();
    });

    it('refuses an unknown action with a field error', async () => {
      const res = await apiFetch(base, '/escalated/admin/tickets/bulk', {
        ...asAdmin,
        body: { ticket_ids: [1], action: 'explode', value: 1 },
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(res.status).toBe(422);
      expect((await res.json()).errors).toHaveProperty('action');
    });
  });

  describe('saved views', () => {
    const json = (path: string, method: string, body?: unknown, as: 'admin' | 'agent' = 'admin') =>
      apiFetch(base, path, {
        as,
        method,
        body,
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });

    it('stores, renames and deletes the admin’s own views', async () => {
      const created = await json('/escalated/admin/saved-views', 'POST', {
        name: 'Urgent ones',
        filters: { priority: 'urgent' },
        is_shared: true,
      });
      expect(created.status).toBe(201);
      const view = await created.json();
      expect(view).toMatchObject({
        name: 'Urgent ones',
        filters: { priority: 'urgent' },
        is_shared: true,
        user_id: ADMIN,
      });

      const renamed = await json(`/escalated/admin/saved-views/${view.id}`, 'PUT', {
        name: 'Hot',
        filters: { priority: 'urgent', status: 'open' },
      });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({
        name: 'Hot',
        filters: { priority: 'urgent', status: 'open' },
      });

      const deleted = await json(`/escalated/admin/saved-views/${view.id}`, 'DELETE');
      expect(deleted.status).toBe(200);
      expect(await source.getRepository(SavedView).countBy({ id: view.id })).toBe(0);
    });

    it('refuses to change another user’s view, and needs a name', async () => {
      const theirs = await source
        .getRepository(SavedView)
        .save({ name: 'Agent view', userId: AGENT, filters: {} });
      const res = await json(`/escalated/admin/saved-views/${theirs.id}`, 'PUT', {
        name: 'Mine now',
        filters: {},
      });
      expect(res.status).toBe(403);
      const gone = await json(`/escalated/admin/saved-views/${theirs.id}`, 'DELETE');
      expect(gone.status).toBe(403);

      const nameless = await json('/escalated/admin/saved-views', 'POST', { filters: {} });
      expect(nameless.status).toBe(422);
    });
  });

  it('names every route the admin ticket screens call', async () => {
    const result = await page(base, '/escalated/admin/tickets', asAdmin);
    const routes = Object.keys(result.props.ziggy.routes);
    for (const name of [
      'escalated.admin.tickets.index',
      'escalated.admin.tickets.show',
      'escalated.admin.tickets.bulk',
      'escalated.admin.tickets.reply',
      'escalated.admin.tickets.note',
      'escalated.admin.tickets.assign',
      'escalated.admin.tickets.status',
      'escalated.admin.tickets.priority',
      'escalated.admin.tickets.tags',
      'escalated.admin.tickets.department',
      'escalated.admin.tickets.macro',
      'escalated.admin.tickets.follow',
      'escalated.admin.tickets.snooze',
      'escalated.admin.tickets.unsnooze',
      'escalated.admin.saved-views.store',
      'escalated.admin.saved-views.update',
      'escalated.admin.saved-views.destroy',
    ]) {
      expect(routes).toContain(name);
    }
  });
});
