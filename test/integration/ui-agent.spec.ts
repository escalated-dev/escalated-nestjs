import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CannedResponse,
  Department,
  Macro,
  Reply,
  Tag,
  Ticket,
  TicketFollower,
  TicketStatus,
} from '../../src/entities';
import { bootEscalatedModule } from './boot-escalated-module';
import {
  AGENT,
  apiFetch,
  bootUi,
  cookieFrom,
  CUSTOMER,
  expectManifestProps,
  guardFor,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The Inertia protocol and the agent screens, over real HTTP and SQLite, with
 * escalated-laravel's agent controllers as the prop contract.
 */
describe('agent screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let resolved: TicketStatus;
  let billing: Department;
  let vip: Tag;
  let urgent: Tag;
  let seq = 0;

  const makeTicket = async (overrides: Partial<Ticket> = {}) => {
    seq += 1;
    return source.getRepository(Ticket).save(
      source.getRepository(Ticket).create({
        referenceNumber: `ESC-${1000 + seq}`,
        subject: `Ticket ${seq}`,
        description: 'Something broke',
        priority: 'medium',
        channel: 'web',
        statusId: open.id,
        requesterId: CUSTOMER,
        guestAccessToken: `token-${seq}`,
        ...overrides,
      }),
    );
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: { enabled: true, version: 'v1', scripts: ['/build/app.js'] },
    }));
    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
    resolved = await statuses.save({ name: 'Resolved', slug: 'resolved', isClosed: true });
    billing = await source.getRepository(Department).save({ name: 'Billing', slug: 'billing' });
    vip = await source.getRepository(Tag).save({ name: 'VIP', slug: 'vip', color: '#f00' });
    urgent = await source.getRepository(Tag).save({ name: 'Urgent', slug: 'urgent' });
  });

  afterAll(async () => {
    await app?.close();
  });

  const v1 = { headers: { 'x-inertia-version': 'v1' } };

  describe('the Inertia protocol', () => {
    it('serves a first visit as an HTML document carrying the page', async () => {
      const res = await fetch(`${base}/escalated/agent`, {
        headers: { accept: 'text/html', 'x-role': 'agent', 'x-user': String(AGENT) },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('vary')).toContain('X-Inertia');
      const html = await res.text();
      expect(html).toContain('<div id="app" data-page="');
      expect(html).toContain('<script type="module" src="/build/app.js"></script>');

      const json = html.match(
        /<script data-page="app" type="application\/json">(.*?)<\/script>/s,
      )![1];
      const pageObject = JSON.parse(json);
      expect(pageObject).toMatchObject({
        component: 'Escalated/Agent/Dashboard',
        url: '/escalated/agent',
        version: 'v1',
      });
      expect(html).not.toMatch(/<\/script>.*<\/script>.*<\/script>.*<\/script>.*<\/script>/s);
    });

    it('answers an Inertia visit with the page object as JSON', async () => {
      const res = await inertiaFetch(base, '/escalated/agent', v1);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-inertia')).toBe('true');
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.json();
      expect(body).toMatchObject({
        component: 'Escalated/Agent/Dashboard',
        url: '/escalated/agent',
        version: 'v1',
        encryptHistory: false,
        clearHistory: false,
      });
    });

    it('answers a stale asset version with 409 and the location to reload', async () => {
      const res = await inertiaFetch(base, '/escalated/agent/tickets?status=open', {
        headers: { 'x-inertia-version': 'old' },
      });
      expect(res.status).toBe(409);
      expect(res.headers.get('x-inertia-location')).toBe(
        `${base}/escalated/agent/tickets?status=open`,
      );
    });

    it('shares the auth user, flash, errors, the escalated block and the named routes', async () => {
      const { props } = await page(base, '/escalated/agent', v1);
      expect(props.auth).toEqual({ user: { id: AGENT, name: `Person ${AGENT}`, email: null } });
      expect(props.flash).toEqual({ success: null, error: null });
      expect(props.errors).toEqual({});
      expect(props.escalated).toMatchObject({
        prefix: 'escalated',
        is_agent: true,
        is_admin: false,
        permissions: [],
        features: { newsletters: false },
        broadcasting: { channel_prefix: '' },
        knowledge_base_enabled: true,
      });
      expect(props.ziggy.routes['escalated.agent.tickets.show']).toEqual({
        uri: 'escalated/agent/tickets/{ticket}',
        methods: ['GET', 'HEAD'],
      });
    });

    it('marks an admin as an admin by asking the host admin guard', async () => {
      const { props } = await page(base, '/escalated/agent', { ...v1, as: 'admin' });
      expect(props.escalated).toMatchObject({ is_admin: true, is_agent: true });
    });

    it('sends only the requested props on a partial reload, plus errors', async () => {
      const { props } = await page(base, '/escalated/agent', {
        headers: {
          ...v1.headers,
          'x-inertia-partial-component': 'Escalated/Agent/Dashboard',
          'x-inertia-partial-data': 'stats',
        },
      });
      expect(Object.keys(props).sort()).toEqual(['errors', 'stats']);
    });

    it('keeps the JSON API for clients that do not ask for a page', async () => {
      await makeTicket();
      const res = await apiFetch(base, '/escalated/agent/tickets');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).not.toHaveProperty('component');
    });

    it('redirects a form back with 303 and carries the flash message to the next page', async () => {
      const ticket = await makeTicket();
      const show = `/escalated/agent/tickets/${ticket.referenceNumber}`;
      const res = await inertiaFetch(base, `${show}/note`, {
        body: { body: 'Checked the logs' },
        headers: { referer: `${base}${show}` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(show);

      const cookie = cookieFrom(res);
      expect(cookie).toMatch(/^escalated_flash=/);
      const next = await inertiaFetch(base, show, { headers: { ...v1.headers, cookie } });
      expect(next.headers.get('set-cookie')).toMatch(/escalated_flash=;.*Max-Age=0/);
      const { props, flash } = await next.json();
      expect(props.flash).toEqual({ success: 'Note added.', error: null });
      expect(flash).toEqual({ success: 'Note added.' });
    });

    it('sends invalid form input back with the field errors', async () => {
      const ticket = await makeTicket();
      const show = `/escalated/agent/tickets/${ticket.referenceNumber}`;
      const res = await inertiaFetch(base, `${show}/status`, {
        body: { status: 'nonsense' },
        headers: { referer: `${base}${show}` },
      });
      expect(res.status).toBe(303);
      const next = await page(base, show, { headers: { ...v1.headers, cookie: cookieFrom(res) } });
      expect(next.props.errors).toEqual({ status: 'The selected status is invalid.' });
    });

    it('refuses a screen form that a page script did not send', async () => {
      const ticket = await makeTicket();
      const res = await fetch(`${base}/escalated/agent/tickets/${ticket.id}/note`, {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'application/json',
          'x-role': 'agent',
          'x-user': String(AGENT),
        },
        body: JSON.stringify({ body: 'cross-site' }),
      });
      expect(res.status).toBe(403);
      expect(await source.getRepository(Reply).countBy({ ticketId: ticket.id })).toBe(0);
    });

    it('uses the host root view when one is given', async () => {
      const custom = await bootUi({
        ui: {
          enabled: true,
          rootView: (pageObject) => `<main data-component="${pageObject.component}"></main>`,
        },
      });
      try {
        const res = await fetch(`${custom.base}/escalated/agent`, {
          headers: { accept: 'text/html', 'x-role': 'agent', 'x-user': String(AGENT) },
        });
        expect(await res.text()).toBe('<main data-component="Escalated/Agent/Dashboard"></main>');
      } finally {
        await custom.app.close();
      }
    });
  });

  describe('Escalated/Agent/Dashboard', () => {
    it('sends the stats, recent tickets, needs-attention lists and performance', async () => {
      await makeTicket({ assigneeId: AGENT });
      await makeTicket({ priority: 'urgent' });
      await makeTicket({ slaFirstResponseBreached: true });
      await makeTicket({ statusId: resolved.id, resolvedAt: new Date(), assigneeId: AGENT });

      const result = await page(base, '/escalated/agent', v1);
      expect(result.component).toBe('Escalated/Agent/Dashboard');
      expectManifestProps(result);
      const { props } = result;
      expect(Object.keys(props.stats).sort()).toEqual(
        ['my_assigned', 'open', 'resolved_today', 'sla_breached', 'unassigned'].sort(),
      );
      expect(props.stats.my_assigned).toBeGreaterThanOrEqual(1);
      expect(props.stats.sla_breached).toBeGreaterThanOrEqual(1);
      expect(props.stats.resolved_today).toBeGreaterThanOrEqual(1);
      expect(props.myPerformance.resolved_this_week).toBeGreaterThanOrEqual(1);
      expect(props.needsAttention.unassigned_urgent.map((t: any) => t.priority)).toContain(
        'urgent',
      );
      expect(props.needsAttention.sla_breaching.length).toBeGreaterThanOrEqual(1);
      expect(props.recentTickets[0]).toMatchObject({
        reference: expect.stringMatching(/^ESC-/),
        status: expect.any(String),
        requester: { id: CUSTOMER, name: expect.any(String) },
      });
    });
  });

  describe('Escalated/Agent/TicketIndex', () => {
    it('sends a paginated ticket list, the filters, departments and tags', async () => {
      const filed = await makeTicket({ subject: 'Invoice is wrong', departmentId: billing.id });
      const result = await page(
        base,
        `/escalated/agent/tickets?status=open&department_id=${billing.id}&search=Invoice`,
        v1,
      );
      expect(result.component).toBe('Escalated/Agent/TicketIndex');
      expectManifestProps(result);
      const { props } = result;
      expect(props.tickets).toMatchObject({ current_page: 1, per_page: 25, total: 1 });
      expect(props.tickets.data).toHaveLength(1);
      expect(props.tickets.data[0]).toMatchObject({
        id: filed.id,
        reference: filed.referenceNumber,
        subject: 'Invoice is wrong',
        status: 'open',
        department: { id: billing.id, name: 'Billing' },
      });
      expect(props.filters).toEqual({
        status: 'open',
        department_id: String(billing.id),
        search: 'Invoice',
      });
      expect(props.departments).toContainEqual({ id: billing.id, name: 'Billing' });
      expect(props.tags).toContainEqual({ id: vip.id, name: 'VIP', color: '#f00' });
    });
  });

  describe('Escalated/Agent/TicketShow', () => {
    it('opens a ticket by reference with everything the screen reads', async () => {
      const ticket = await makeTicket({ departmentId: billing.id });
      const replies = source.getRepository(Reply);
      await replies.save({ ticketId: ticket.id, userId: CUSTOMER, body: 'First', type: 'reply' });
      await new Promise((r) => setTimeout(r, 1100));
      await replies.save({
        ticketId: ticket.id,
        userId: AGENT,
        body: 'Internal',
        type: 'note',
        isInternal: true,
      });
      await source
        .getRepository(CannedResponse)
        .save({ title: 'Thanks', shortCode: 'thx', content: 'Thank you!', scope: 'shared' });
      await source.getRepository(Macro).save({
        name: 'Close it',
        description: 'Resolve',
        actions: [],
        scope: 'shared',
      });

      const result = await page(base, `/escalated/agent/tickets/${ticket.referenceNumber}`, v1);
      expect(result.component).toBe('Escalated/Agent/TicketShow');
      expectManifestProps(result);
      const { props } = result;
      expect(props.ticket).toMatchObject({
        id: ticket.id,
        reference: ticket.referenceNumber,
        status: 'open',
        department: { id: billing.id, name: 'Billing' },
        requester_ticket_count: expect.any(Number),
        related_tickets: [],
        pinned_notes: [],
      });
      expect(props.ticket.replies.map((r: any) => [r.body, r.is_internal_note])).toEqual([
        ['Internal', true],
        ['First', false],
      ]);
      expect(props.ticket.replies[0].author).toMatchObject({ id: AGENT });
      expect(props.cannedResponses).toContainEqual(
        expect.objectContaining({ title: 'Thanks', body: 'Thank you!' }),
      );
      expect(props.macros).toContainEqual(expect.objectContaining({ name: 'Close it' }));
      expect(props.is_following).toBe(false);
      expect(props.followers_count).toBe(0);
      expect(props.customActions).toEqual([]);
    });

    it('still answers the JSON API by numeric id', async () => {
      const ticket = await makeTicket();
      const res = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ticket.referenceNumber).toBe(ticket.referenceNumber);
    });
  });

  describe('ticket actions the screen posts', () => {
    const act = async (ticket: Ticket, action: string, body: unknown) => {
      const show = `/escalated/agent/tickets/${ticket.referenceNumber}`;
      const res = await inertiaFetch(base, `${show}/${action}`, {
        body,
        headers: { referer: `${base}${show}` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(show);
      return source.getRepository(Ticket).findOneOrFail({
        where: { id: ticket.id },
        relations: { tags: true },
      });
    };

    it('replies publicly', async () => {
      const ticket = await makeTicket();
      await act(ticket, 'reply', { body: 'We are on it', is_internal_note: false });
      const reply = await source.getRepository(Reply).findOneByOrFail({ ticketId: ticket.id });
      expect(reply).toMatchObject({ body: 'We are on it', isInternal: false, userId: AGENT });
    });

    it('adds an internal note', async () => {
      const ticket = await makeTicket();
      await act(ticket, 'note', { body: 'Customer is VIP' });
      const reply = await source.getRepository(Reply).findOneByOrFail({ ticketId: ticket.id });
      expect(reply).toMatchObject({ isInternal: true, userId: AGENT });
    });

    it('assigns, changes status, priority, tags and department', async () => {
      const ticket = await makeTicket();
      expect((await act(ticket, 'assign', { agent_id: AGENT })).assigneeId).toBe(AGENT);
      expect((await act(ticket, 'status', { status: 'resolved' })).statusId).toBe(resolved.id);
      expect((await act(ticket, 'priority', { priority: 'high' })).priority).toBe('high');
      const tagged = await act(ticket, 'tags', { tag_ids: [vip.id, urgent.id] });
      expect(tagged.tags.map((t) => t.id).sort()).toEqual([vip.id, urgent.id].sort());
      expect((await act(ticket, 'department', { department_id: billing.id })).departmentId).toBe(
        billing.id,
      );
    });

    it('follows and unfollows', async () => {
      const ticket = await makeTicket();
      await act(ticket, 'follow', {});
      expect(
        await source.getRepository(TicketFollower).countBy({ ticketId: ticket.id, userId: AGENT }),
      ).toBe(1);
      await act(ticket, 'follow', {});
      expect(await source.getRepository(TicketFollower).countBy({ ticketId: ticket.id })).toBe(0);
    });

    it('applies a macro the agent may use', async () => {
      const ticket = await makeTicket();
      const macro = await source.getRepository(Macro).save({
        name: 'Escalate',
        actions: [{ type: 'set_priority', value: 'urgent' }],
        scope: 'shared',
      });
      expect((await act(ticket, 'macro', { macro_id: macro.id })).priority).toBe('urgent');
    });

    it('answers an API client with JSON and validation errors as 422', async () => {
      const ticket = await makeTicket();
      const ok = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}/priority`, {
        body: { priority: 'low' },
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ message: 'Priority updated.' });

      const bad = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}/priority`, {
        body: { priority: 'whenever' },
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(bad.status).toBe(422);
      expect(await bad.json()).toMatchObject({
        errors: { priority: 'The selected priority is invalid.' },
      });
    });
  });
});

describe('agent screens (ui off, the default)', () => {
  it('registers no screen routes and keeps every response JSON', async () => {
    const moduleRef = await bootEscalatedModule({
      escalated: { agentGuard: guardFor('agent') },
    });
    const source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    try {
      const html = { headers: { accept: 'text/html', 'x-inertia': 'true' } };
      const dashboard = await inertiaFetch(base, '/escalated/agent', html);
      expect(dashboard.status).toBe(404);

      const list = await inertiaFetch(base, '/escalated/agent/tickets', html);
      expect(list.status).toBe(200);
      expect(list.headers.get('x-inertia')).toBeNull();
      expect(await list.json()).toMatchObject({ data: [], total: 0 });
    } finally {
      await app.close();
    }
  });
});
