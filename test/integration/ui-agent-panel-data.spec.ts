import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import {
  AgentNotification,
  AgentProfile,
  ChatSession,
  CustomerPresence,
  Department,
  KbArticle,
  KbCategory,
  Ticket,
  TicketRead,
} from '../../src/entities';
import {
  ChatTransferredEvent,
  ESCALATED_EVENTS,
  SlaBreachedEvent,
  SlaWarningEvent,
} from '../../src/events/escalated.events';
import { ChatSessionService } from '../../src/services/chat-session.service';
import { ReplyService } from '../../src/services/reply.service';
import { TicketService } from '../../src/services/ticket.service';
import { ADMIN, AGENT, apiFetch, bootUi, CUSTOMER, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * The agent panel's data (ADR 2026-11-05-agent-panel-data): the agent's own
 * status, knowledge-base search, per-agent unread markers, customer presence
 * and the notifications feed, through the real HTTP routes.
 */

const OTHER_AGENT = 22;
const v1 = { headers: { 'x-inertia-version': 'v1' } };
const INDEX = '/escalated/agent/tickets';

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 50 && !done(value); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

async function json(res: Response) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function as(user: number, role = 'agent') {
  return { 'x-role': role, 'x-user': String(user) };
}

describe('agent panel data (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let tickets: TicketService;
  let replies: ReplyService;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: { enabled: true, version: 'v1', agentInbox: { cacheSeconds: 0 } },
    }));
    tickets = app.get(TicketService);
    replies = app.get(ReplyService);
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    for (const entity of [AgentNotification, TicketRead, CustomerPresence, ChatSession]) {
      await source.getRepository(entity).clear();
    }
    await source.getRepository(Ticket).createQueryBuilder().delete().execute();
    await source.getRepository(AgentProfile).createQueryBuilder().delete().execute();
    await source.getRepository(KbArticle).clear();
    await source.getRepository(KbCategory).createQueryBuilder().delete().execute();
  });

  const customerTicket = (subject = 'Printer on fire', extra: Record<string, unknown> = {}) =>
    tickets.create({ subject, description: 'It is on fire', ...extra } as any, CUSTOMER);

  async function rows(user = AGENT): Promise<Record<string, any>> {
    const result = await page(base, INDEX, {
      ...v1,
      headers: { ...v1.headers, ...as(user) },
    });
    return Object.fromEntries(result.props.tickets.data.map((row: any) => [row.reference, row]));
  }

  async function open(ticket: Ticket, user = AGENT) {
    return page(base, `${INDEX}/${ticket.referenceNumber}`, {
      ...v1,
      headers: { ...v1.headers, ...as(user) },
    });
  }

  // ---- 3. The agent's own status ---------------------------------------

  describe('agent status', () => {
    it.each(['PUT', 'POST'])('lets an agent set their own status with %s', async (method) => {
      const res = await apiFetch(base, '/escalated/agent/status', {
        method,
        body: { status: 'away' },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ agent_status: 'away' });

      const profile = await source.getRepository(AgentProfile).findOneByOrFail({ userId: AGENT });
      expect(profile.chatStatus).toBe('away');
      // Away agents get no chats: routing reads isAvailable.
      expect(profile.isAvailable).toBe(false);
    });

    it('is the availability chat routing reads', async () => {
      await apiFetch(base, '/escalated/agent/status', {
        method: 'PUT',
        body: { status: 'online' },
      });
      expect(
        (await source.getRepository(AgentProfile).findOneByOrFail({ userId: AGENT })).isAvailable,
      ).toBe(true);
      await apiFetch(base, '/escalated/agent/status', {
        method: 'PUT',
        body: { status: 'offline' },
      });
      expect(
        (await source.getRepository(AgentProfile).findOneByOrFail({ userId: AGENT })).isAvailable,
      ).toBe(false);
    });

    it('rejects a status outside the allowed values', async () => {
      const res = await apiFetch(base, '/escalated/agent/status', {
        method: 'PUT',
        body: { status: 'busy' },
      });
      expect(res.status).toBe(422);
      expect(await source.getRepository(AgentProfile).countBy({ userId: AGENT })).toBe(0);
    });

    it('is refused to a non-agent', async () => {
      const res = await apiFetch(base, '/escalated/agent/status', {
        as: 'customer',
        method: 'PUT',
        body: { status: 'online' },
      });
      expect(res.status).toBe(403);
    });

    it('redirects an Inertia visit back', async () => {
      const res = await inertiaFetch(base, '/escalated/agent/status', {
        method: 'PUT',
        body: { status: 'away' },
        headers: { referer: `${base}${INDEX}` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(INDEX);
    });

    it('shares agent_status and agent_statuses with agents only', async () => {
      const before = await page(base, INDEX, v1);
      expect(before.props.escalated.agent_status).toBe('offline');
      expect(before.props.escalated.agent_statuses).toEqual(['online', 'away', 'offline']);

      await apiFetch(base, '/escalated/agent/status', { method: 'PUT', body: { status: 'away' } });
      expect((await page(base, INDEX, v1)).props.escalated.agent_status).toBe('away');

      const customer = await page(base, '/escalated', { ...v1, as: 'customer' });
      expect(customer.props.escalated).not.toHaveProperty('agent_status');
      expect(customer.props.escalated).not.toHaveProperty('agent_statuses');
      expect(customer.props.escalated).not.toHaveProperty('notifications');
    });
  });

  // ---- 5. Knowledge-base search ----------------------------------------

  describe('knowledge-base search', () => {
    let n = 0;
    const article = (values: Partial<KbArticle> = {}) => {
      n += 1;
      return source.getRepository(KbArticle).save({
        title: `Article ${n}`,
        slug: `article-${n}-${Date.now()}`,
        content: '<p>Body</p>',
        status: 'published',
        publishedAt: new Date(),
        ...values,
      });
    };
    const search = async (query: string) => {
      const res = await apiFetch(base, `/escalated/agent/kb/search?${query}`);
      return { status: res.status, body: await json(res) };
    };

    it('returns matching published articles with the contract fields', async () => {
      const category = await source
        .getRepository(KbCategory)
        .save({ name: 'Billing', slug: `billing-${Date.now()}` });
      const found = await article({
        title: 'Resetting your password',
        slug: 'resetting-your-password',
        content: '<p>Open <strong>Settings</strong> and choose Reset.</p>',
        categoryId: category.id,
      });

      const { status, body } = await search('q=password');
      expect(status).toBe(200);
      expect(body).toEqual({
        data: [
          {
            id: found.id,
            title: 'Resetting your password',
            excerpt: 'Open Settings and choose Reset.',
            url: `${base}/escalated/kb/resetting-your-password`,
            category: { id: category.id, name: 'Billing' },
            updated_at: new Date(found.updatedAt).toISOString(),
          },
        ],
      });
    });

    it('never returns drafts', async () => {
      await article({ title: 'Draft about refunds', status: 'draft' });
      await article({ title: 'Refunds explained' });
      const { body } = await search('q=refunds');
      expect(body.data.map((row: any) => row.title)).toEqual(['Refunds explained']);
    });

    it('ranks title matches before body matches, then the most recently updated', async () => {
      const bodyOnly = await article({ title: 'Getting started', content: 'How invoices work' });
      const older = await article({ title: 'Invoices (old)' });
      const newer = await article({ title: 'Invoices (new)' });
      const repo = source.getRepository(KbArticle);
      await repo.update(older.id, { updatedAt: new Date('2026-11-01T10:00:00Z') });
      await repo.update(newer.id, { updatedAt: new Date('2026-11-02T10:00:00Z') });
      await repo.update(bodyOnly.id, { updatedAt: new Date('2026-11-03T10:00:00Z') });

      const { body } = await search('q=invoices');
      expect(body.data.map((row: any) => row.id)).toEqual([newer.id, older.id, bodyOnly.id]);
    });

    it('ignores case', async () => {
      const found = await article({ title: 'Resetting your Password' });
      expect((await search('q=PASSWORD')).body.data.map((row: any) => row.id)).toEqual([found.id]);
    });

    it.each(['%25%25', '__', '0%25', 'a_b'])(
      'takes LIKE wildcards in the query literally (%s)',
      async (q) => {
        await article({ title: 'Plain title', content: 'Nothing special' });
        const literal = await article({ title: 'Codes: 100%% off, a_b and x__y', content: '' });
        const { body } = await search(`q=${q}`);
        expect(body.data.map((row: any) => row.id)).toEqual([literal.id]);
      },
    );

    it('caps the number of results', async () => {
      for (let i = 1; i <= 25; i += 1) await article({ title: `Shipping guide ${i}` });
      expect((await search('q=shipping')).body.data).toHaveLength(10);
      expect((await search('q=shipping&limit=20')).body.data).toHaveLength(20);
      expect((await search('q=shipping&limit=21')).status).toBe(422);
    });

    it.each(['q=', 'q=a', `q=${'a'.repeat(201)}`, ''])('validates the query (%s)', async (q) => {
      expect((await search(q)).status).toBe(422);
    });

    it('is for agents only', async () => {
      const res = await apiFetch(base, '/escalated/agent/kb/search?q=password', { as: 'customer' });
      expect(res.status).toBe(403);
    });

    it('also escapes the widget article search', async () => {
      await article({ title: 'Plain title' });
      const res = await fetch(`${base}/escalated/widget/articles?q=${encodeURIComponent('%%')}`);
      expect((await res.json()).articles).toEqual([]);
    });
  });

  // ---- 1. Unread tracking ----------------------------------------------

  describe('unread tickets', () => {
    it('shows a new ticket as unread until the agent opens it', async () => {
      const ticket = await customerTicket();
      expect((await rows())[ticket.referenceNumber].is_unread).toBe(true);

      const show = await open(ticket);
      expect(show.props.ticket.is_unread).toBe(false);
      expect((await rows())[ticket.referenceNumber].is_unread).toBe(false);
    });

    it('keeps read markers per agent', async () => {
      const ticket = await customerTicket();
      await open(ticket);
      expect((await rows(AGENT))[ticket.referenceNumber].is_unread).toBe(false);
      expect((await rows(OTHER_AGENT))[ticket.referenceNumber].is_unread).toBe(true);
    });

    it.each([
      ['the requester', CUSTOMER],
      ['a guest', 0],
    ])('makes a read ticket unread again on a reply from %s', async (_who, author) => {
      const ticket = await customerTicket();
      await open(ticket);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await replies.create(ticket.id, { body: 'Any news?', type: 'reply' }, author);
      expect((await rows())[ticket.referenceNumber].is_unread).toBe(true);
    });

    it('does not make a ticket unread for agent replies or notes', async () => {
      const ticket = await customerTicket();
      await open(ticket);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await replies.create(ticket.id, { body: 'Mine', type: 'reply' }, AGENT);
      await replies.create(ticket.id, { body: 'Colleague', type: 'reply' }, OTHER_AGENT);
      await replies.create(ticket.id, { body: 'Note', type: 'note', isInternal: true }, CUSTOMER);
      expect((await rows())[ticket.referenceNumber].is_unread).toBe(false);
    });

    it('leaves tickets without customer activity read', async () => {
      const ticket = await source.getRepository(Ticket).save({
        referenceNumber: `IMP-${Date.now()}`,
        subject: 'Imported',
        description: 'x',
        requesterId: CUSTOMER,
      });
      expect((await rows())[ticket.referenceNumber].is_unread).toBe(false);
    });

    it('marks a ticket read and unread through the agent routes', async () => {
      const ticket = await customerTicket();
      const path = `${INDEX}/${ticket.referenceNumber}`;

      let res = await apiFetch(base, `${path}/read`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ is_unread: false });
      expect((await rows())[ticket.referenceNumber].is_unread).toBe(false);

      res = await apiFetch(base, `${path}/unread`, { method: 'POST' });
      expect(await res.json()).toEqual({ is_unread: true });
      expect((await rows())[ticket.referenceNumber].is_unread).toBe(true);

      res = await inertiaFetch(base, `${path}/read`, {
        method: 'POST',
        body: {},
        headers: { referer: `${base}${INDEX}` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(INDEX);
    });

    it('marks tickets read and unread in bulk', async () => {
      const a = await customerTicket('A');
      const b = await customerTicket('B');
      const bulk = (action: string, ids: number[]) =>
        apiFetch(base, `${INDEX}/bulk`, {
          method: 'POST',
          body: { ticket_ids: ids, action },
          headers: { 'x-requested-with': 'XMLHttpRequest' },
        });

      expect((await bulk('mark_read', [a.id, b.id])).status).toBe(200);
      let flags = await rows();
      expect([flags[a.referenceNumber].is_unread, flags[b.referenceNumber].is_unread]).toEqual([
        false,
        false,
      ]);

      await bulk('mark_unread', [a.id]);
      flags = await rows();
      expect([flags[a.referenceNumber].is_unread, flags[b.referenceNumber].is_unread]).toEqual([
        true,
        false,
      ]);
    });

    it('counts unread open tickets per queue in inbox.unread', async () => {
      const mine = await customerTicket('Mine', { assigneeId: AGENT });
      await customerTicket('Mine too', { assigneeId: AGENT });
      const unassigned = await customerTicket('Nobody');
      await open(mine);
      await open(unassigned);

      const inbox = (await page(base, INDEX, v1)).props.inbox;
      expect(inbox.unread).toEqual({ mine: 1, unassigned: 0, all: 1 });
    });

    it('removes read markers with the ticket', async () => {
      const ticket = await customerTicket();
      await open(ticket);
      await tickets.delete(ticket.id);
      expect(await source.getRepository(TicketRead).countBy({ ticketId: ticket.id })).toBe(0);
    });
  });

  // ---- 2. Customer presence --------------------------------------------

  describe('customer presence', () => {
    const portal = () =>
      fetch(`${base}/escalated/customer/tickets`, {
        headers: { accept: 'application/json', ...as(CUSTOMER, 'customer') },
      });

    it('shows a customer as online while the portal saw them within the window', async () => {
      const ticket = await customerTicket();
      expect((await rows())[ticket.referenceNumber]).toMatchObject({
        requester_online: false,
        requester_last_seen_at: null,
      });

      expect((await portal()).status).toBe(200);
      const row = (await rows())[ticket.referenceNumber];
      expect(row.requester_online).toBe(true);
      expect(new Date(row.requester_last_seen_at).getTime()).toBeGreaterThan(Date.now() - 10_000);

      // Seen three minutes ago: past the default two-minute window.
      await source
        .getRepository(CustomerPresence)
        .createQueryBuilder()
        .update()
        .set({ lastSeenAt: new Date(Date.now() - 180_000) })
        .execute();
      expect((await rows())[ticket.referenceNumber].requester_online).toBe(false);
    });

    it('writes at most once per customer every 30 seconds', async () => {
      await portal();
      const first = await source.getRepository(CustomerPresence).findOneByOrFail({});
      await portal();
      const second = await source.getRepository(CustomerPresence).findOneByOrFail({});
      expect(new Date(second.lastSeenAt).getTime()).toBe(new Date(first.lastSeenAt).getTime());
      expect(await source.getRepository(CustomerPresence).count()).toBe(1);

      // Once the last write is 30 seconds old, the next request writes again.
      const old = new Date(Date.now() - 31_000);
      await source
        .getRepository(CustomerPresence)
        .createQueryBuilder()
        .update()
        .set({ lastSeenAt: old })
        .execute();
      await portal();
      const third = await source.getRepository(CustomerPresence).findOneByOrFail({});
      expect(new Date(third.lastSeenAt).getTime()).toBeGreaterThan(old.getTime() + 20_000);
    });

    it('records a widget chat visitor', async () => {
      const chats = app.get(ChatSessionService);
      const session = await chats.start('Visitor', 'guest@example.com', 'Hi');
      const { token } = await chats.issueVisitorToken(session);
      const ticket = await source.getRepository(Ticket).findOneByOrFail({ id: session.ticketId });

      const res = await fetch(`${base}/escalated/widget/chat/${token}/messages`);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('requester_online');

      expect((await rows())[ticket.referenceNumber].requester_online).toBe(true);
    });

    it('sends presence on the agent ticket page', async () => {
      const ticket = await customerTicket();
      await portal();
      const show = await open(ticket);
      expect(show.props.ticket.requester_online).toBe(true);
      expect(typeof show.props.ticket.requester_last_seen_at).toBe('string');
    });

    it('does not record staff browsing the customer portal', async () => {
      await source.getRepository(AgentProfile).save({ userId: CUSTOMER });
      await portal();
      expect(await source.getRepository(CustomerPresence).count()).toBe(0);
    });

    it('never shows presence to customers', async () => {
      const ticket = await customerTicket();
      await portal();
      const res = await inertiaFetch(
        base,
        `/escalated/customer/tickets/${ticket.referenceNumber}`,
        {
          as: 'customer',
          ...v1,
        },
      );
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).not.toContain('requester_online');
      expect(text).not.toContain('requester_last_seen_at');
    });
  });

  // ---- 4. Notifications -------------------------------------------------

  describe('notifications', () => {
    const feed = async (query = '', user = AGENT) => {
      const res = await fetch(`${base}/escalated/agent/notifications${query}`, {
        headers: { accept: 'application/json', ...as(user) },
      });
      return { status: res.status, body: await json(res) };
    };
    const settled = (user = AGENT, count = 1) =>
      eventually(
        () => feed('', user),
        (result) => (result.body?.data?.length ?? 0) >= count,
      );

    it('lists a ticket assignment with the contract shape', async () => {
      const ticket = await customerTicket('Printer on fire');
      await tickets.update(ticket.id, { assigneeId: AGENT }, ADMIN);

      const { body } = await settled();
      const row = await source.getRepository(AgentNotification).findOneByOrFail({});
      expect(body).toEqual({
        data: [
          {
            id: row.id,
            type: 'ticket_assigned',
            title: `${ticket.referenceNumber} was assigned to you`,
            body: 'Printer on fire',
            ticket: {
              id: ticket.id,
              reference: ticket.referenceNumber,
              subject: 'Printer on fire',
            },
            url: `/escalated/agent/tickets/${ticket.referenceNumber}`,
            created_at: new Date(row.createdAt).toISOString(),
            read_at: null,
          },
        ],
        meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
        unread_count: 1,
      });
    });

    it('does not notify an agent who assigns a ticket to themselves', async () => {
      const ticket = await customerTicket();
      await tickets.update(ticket.id, { assigneeId: AGENT }, AGENT);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await feed()).body.data).toEqual([]);
    });

    it("notifies the assignee of a customer reply, not of another agent's", async () => {
      const ticket = await customerTicket();
      await source.getRepository(Ticket).update(ticket.id, { assigneeId: AGENT });

      await replies.create(ticket.id, { body: 'From a colleague', type: 'reply' }, OTHER_AGENT);
      await replies.create(ticket.id, { body: 'From the customer', type: 'reply' }, CUSTOMER);

      const { body } = await settled();
      expect(body.data.map((item: any) => [item.type, item.title])).toEqual([
        ['ticket_reply', `New reply on ${ticket.referenceNumber}`],
      ]);
    });

    it('notifies the assignee of SLA warnings and breaches', async () => {
      const ticket = await customerTicket();
      await source.getRepository(Ticket).update(ticket.id, { assigneeId: AGENT });
      const fresh = await source.getRepository(Ticket).findOneByOrFail({ id: ticket.id });
      const events = app.get(EventEmitter2);

      events.emit(ESCALATED_EVENTS.SLA_WARNING, new SlaWarningEvent(fresh, 'first_response', 20));
      events.emit(ESCALATED_EVENTS.SLA_BREACHED, new SlaBreachedEvent(fresh, 'resolution'));

      const { body } = await settled(AGENT, 2);
      expect(body.data.map((item: any) => item.type).sort()).toEqual([
        'sla_breached',
        'sla_warning',
      ]);
      expect(body.data.find((i: any) => i.type === 'sla_warning').title).toBe(
        `SLA due soon on ${ticket.referenceNumber}`,
      );
    });

    it('notifies the receiving agent of a chat transfer, not the sender', async () => {
      const ticket = await customerTicket();
      app
        .get(EventEmitter2)
        .emit(
          ESCALATED_EVENTS.CHAT_TRANSFERRED,
          new ChatTransferredEvent({ id: 7, ticketId: ticket.id }, OTHER_AGENT, AGENT),
        );
      const { body } = await settled();
      expect(body.data.map((item: any) => item.type)).toEqual(['chat_transferred']);
      expect((await feed('', OTHER_AGENT)).body.data).toEqual([]);
    });

    it('pages newest first, filters to unread and marks read', async () => {
      for (const subject of ['Ticket 1', 'Ticket 2', 'Ticket 3']) {
        const ticket = await customerTicket(subject);
        await tickets.update(ticket.id, { assigneeId: AGENT }, ADMIN);
        await settled(AGENT, Number(subject.slice(-1)));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const first = (await feed('?per_page=2')).body;
      expect(first.data.map((item: any) => item.body)).toEqual(['Ticket 3', 'Ticket 2']);
      expect(first.meta).toEqual({ current_page: 1, last_page: 2, per_page: 2, total: 3 });

      const read = await apiFetch(base, `/escalated/agent/notifications/${first.data[0].id}/read`, {
        method: 'POST',
      });
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual({ unread_count: 2 });

      const unread = (await feed('?unread=1')).body;
      expect(unread.data.map((item: any) => item.body)).toEqual(['Ticket 2', 'Ticket 1']);

      expect((await feed('?per_page=51')).status).toBe(422);

      const all = await apiFetch(base, '/escalated/agent/notifications/read-all', {
        method: 'POST',
      });
      expect(await all.json()).toEqual({ unread_count: 0 });
      expect((await feed()).body.unread_count).toBe(0);
    });

    it("will not mark another agent's notification read", async () => {
      const ticket = await customerTicket();
      await tickets.update(ticket.id, { assigneeId: OTHER_AGENT }, ADMIN);
      const { body } = await settled(OTHER_AGENT);

      const res = await apiFetch(base, `/escalated/agent/notifications/${body.data[0].id}/read`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      expect((await source.getRepository(AgentNotification).findOneByOrFail({})).readAt).toBeNull();
    });

    it('shares the unread count with agents', async () => {
      const ticket = await customerTicket();
      await tickets.update(ticket.id, { assigneeId: AGENT }, ADMIN);
      await settled();
      expect((await page(base, INDEX, v1)).props.escalated.notifications).toEqual({
        unread_count: 1,
      });
    });

    it('redacts a deleted ticket but keeps the item', async () => {
      const ticket = await customerTicket('Secret subject');
      await tickets.update(ticket.id, { assigneeId: AGENT }, ADMIN);
      await settled();
      await source.getRepository(Ticket).delete(ticket.id);

      const item = (await feed()).body.data[0];
      expect(item).toMatchObject({
        type: 'ticket_assigned',
        title: 'A ticket you can no longer view',
        body: null,
        ticket: null,
        url: null,
      });
      expect(JSON.stringify(item)).not.toContain('Secret subject');
    });

    it('is for agents only', async () => {
      const res = await fetch(`${base}/escalated/agent/notifications`, {
        headers: { accept: 'application/json', ...as(CUSTOMER, 'customer') },
      });
      expect(res.status).toBe(403);
    });
  });
});

describe('agent panel data with department visibility', () => {
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

  it('only counts and marks tickets the agent may see', async () => {
    const departments = source.getRepository(Department);
    const support = await departments.save({ name: 'Support', slug: 'support' });
    const sales = await departments.save({ name: 'Sales', slug: 'sales' });
    await source.getRepository(AgentProfile).save({ userId: AGENT, departments: [support] });
    const service = app.get(TicketService);
    const visible = await service.create(
      { subject: 'Visible', description: 'x', departmentId: support.id } as any,
      CUSTOMER,
    );
    const hidden = await service.create(
      { subject: 'Hidden', description: 'x', departmentId: sales.id } as any,
      CUSTOMER,
    );

    expect((await page(base, INDEX, v1)).props.inbox.unread.all).toBe(1);

    const res = await apiFetch(base, `${INDEX}/${hidden.referenceNumber}/read`, { method: 'POST' });
    expect(res.status).toBe(404);
    await apiFetch(base, `${INDEX}/bulk`, {
      method: 'POST',
      body: { ticket_ids: [hidden.id, visible.id], action: 'mark_read' },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    const markers = await source.getRepository(TicketRead).find();
    expect(markers.map((m) => m.ticketId)).toEqual([visible.id]);
  });

  it('redacts notifications for tickets the agent can no longer view', async () => {
    const departments = source.getRepository(Department);
    const billing = await departments.save({ name: 'Billing', slug: 'billing' });
    const ticket = await source.getRepository(Ticket).save({
      referenceNumber: `RED-${Date.now()}`,
      subject: 'Secret subject',
      description: 'x',
      requesterId: CUSTOMER,
      departmentId: billing.id,
    });
    await source.getRepository(AgentNotification).save({
      id: '00000000-0000-4000-8000-000000000001',
      userId: AGENT,
      type: 'ticket_assigned',
      data: { ticket_id: ticket.id, reference: ticket.referenceNumber },
      readAt: null,
      createdAt: new Date(),
    });

    const res = await fetch(`${base}/escalated/agent/notifications`, {
      headers: { accept: 'application/json', ...as(AGENT) },
    });
    const item = (await res.json()).data[0];
    expect(item).toMatchObject({
      title: 'A ticket you can no longer view',
      body: null,
      ticket: null,
      url: null,
    });
    expect(JSON.stringify(item)).not.toContain('Secret subject');
  });
});

describe('agent panel data switched off', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootUi({
      ui: { enabled: true, version: 'v1' },
      enableKnowledgeBase: false,
      agentNotifications: false,
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 404 for knowledge-base search while the knowledge base is off', async () => {
    expect((await apiFetch(base, '/escalated/agent/kb/search?q=password')).status).toBe(404);
  });

  it('has no notifications feed or shared count', async () => {
    expect((await apiFetch(base, '/escalated/agent/notifications')).status).toBe(404);
    expect(
      (await apiFetch(base, '/escalated/agent/notifications/read-all', { method: 'POST' })).status,
    ).toBe(404);
    expect((await page(base, INDEX, v1)).props.escalated).not.toHaveProperty('notifications');
  });
});
