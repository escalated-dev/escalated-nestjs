import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentProfile, Contact, Department, Ticket, TicketStatus } from '../../src/entities';
import { mappedPermissions } from '../../src/access/route-permissions';
import { routeUrl } from '../../src/ui/routes';
import {
  ADMIN,
  AGENT,
  apiFetch,
  bootUi,
  cookieFrom,
  CUSTOMER,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * What the agent ticket page needs beyond the ticket itself, as
 * escalated-laravel sends it: the agents the ticket can be reassigned to, the
 * requester's other tickets, and snoozing from the agent panel (until now
 * only the admin panel could snooze).
 */

const OTHER_AGENT = 22;
const v1 = { headers: { 'x-inertia-version': 'v1' } };
const hours = (n: number) => new Date(Date.now() + n * 3600_000);

function maker(source: DataSource, open: () => TicketStatus) {
  let seq = 0;
  return (overrides: Partial<Ticket> = {}) => {
    seq += 1;
    const repo = source.getRepository(Ticket);
    return repo.save(
      repo.create({
        referenceNumber: `WS-${seq}-${Date.now()}`,
        subject: `Ticket ${seq}`,
        description: 'Something broke',
        priority: 'medium',
        channel: 'web',
        statusId: open().id,
        requesterId: CUSTOMER,
        ...overrides,
      }),
    );
  };
}

const showProps = async (base: string, ticket: Ticket) =>
  (await page(base, `/escalated/agent/tickets/${ticket.referenceNumber}`, v1)).props;

describe('agent workspace (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let inProgress: TicketStatus;
  let make: ReturnType<typeof maker>;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({ ui: { enabled: true, version: 'v1' } }));
    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
    inProgress = await statuses.save({ name: 'In progress', slug: 'in_progress' });
    make = maker(source, () => open);
    const profiles = source.getRepository(AgentProfile);
    await profiles.save({ userId: AGENT, displayName: 'Ada Agent' });
    await profiles.save({ userId: ADMIN, displayName: 'Al Admin' });
    await profiles.save({ userId: OTHER_AGENT, displayName: 'Gone Agent', isActive: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await source.getRepository(Ticket).createQueryBuilder().delete().execute();
  });

  describe('agents', () => {
    it('sends the active agents and admins a ticket can be assigned to, by id and name', async () => {
      const ticket = await make();
      expect((await showProps(base, ticket)).agents).toEqual([
        { id: AGENT, name: 'Ada Agent' },
        { id: ADMIN, name: 'Al Admin' },
      ]);
    });
  });

  describe('ticket.requester_tickets', () => {
    it("sends the requester's other tickets, newest first, at most five", async () => {
      const older: Ticket[] = [];
      for (let i = 1; i <= 6; i += 1) {
        older.push(await make({ subject: `Earlier ${i}`, createdAt: hours(-(10 - i) * 24) }));
      }
      await make({ subject: 'Someone else', requesterId: 999 });
      const ticket = await make({ subject: 'Current' });

      const recent = (await showProps(base, ticket)).ticket.requester_tickets;

      expect(recent.map((t: any) => t.subject)).toEqual([
        'Earlier 6',
        'Earlier 5',
        'Earlier 4',
        'Earlier 3',
        'Earlier 2',
      ]);
      expect(Object.keys(recent[0])).toEqual([
        'id',
        'reference',
        'subject',
        'status',
        'created_at',
        'updated_at',
      ]);
      expect(recent[0]).toMatchObject({
        id: older[5].id,
        reference: older[5].referenceNumber,
        status: 'open',
        created_at: older[5].createdAt.toISOString(),
      });
    });

    it("matches a guest requester's other tickets by email", async () => {
      const contacts = source.getRepository(Contact);
      const gus = await contacts.save({ email: 'guest@example.com', name: 'Gus' });
      const other = await contacts.save({ email: 'other@example.com', name: 'Otto' });
      await make({ requesterId: 0, contactId: gus.id, subject: 'Earlier guest ticket' });
      await make({ requesterId: 0, contactId: other.id, subject: 'Another guest' });
      await make({ requesterId: 0, contactId: null, subject: 'No one' });
      const ticket = await make({ requesterId: 0, contactId: gus.id });

      const recent = (await showProps(base, ticket)).ticket.requester_tickets;

      expect(recent.map((t: any) => t.subject)).toEqual(['Earlier guest ticket']);
      await contacts.clear();
    });

    it('sends an empty list for a ticket with no known requester', async () => {
      await make({ requesterId: 0, contactId: null });
      const ticket = await make({ requesterId: 0, contactId: null });

      expect((await showProps(base, ticket)).ticket.requester_tickets).toEqual([]);
    });

    it('leaves related_tickets meaning linked tickets', async () => {
      await make();
      const ticket = await make();
      expect((await showProps(base, ticket)).ticket.related_tickets).toEqual([]);
    });
  });

  describe('snoozing from the agent panel', () => {
    const post = (ticket: Ticket, action: string, body: unknown, as?: 'customer') => {
      const show = `/escalated/agent/tickets/${ticket.referenceNumber}`;
      return inertiaFetch(base, `${show}/${action}`, {
        as,
        body,
        headers: { referer: `${base}${show}` },
      });
    };
    const reload = (ticket: Ticket) =>
      source.getRepository(Ticket).findOneByOrFail({ id: ticket.id });

    it('names the routes as escalated-laravel does', () => {
      expect(routeUrl('escalated.agent.tickets.snooze', { ticket: 'ESC-1' })).toBe(
        '/escalated/agent/tickets/ESC-1/snooze',
      );
      expect(routeUrl('escalated.agent.tickets.unsnooze', { ticket: 'ESC-1' })).toBe(
        '/escalated/agent/tickets/ESC-1/unsnooze',
      );
    });

    it('lets an agent snooze a ticket', async () => {
      const ticket = await make();
      const until = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 24 * 3600_000);

      const res = await post(ticket, 'snooze', { snoozed_until: until.toISOString() });

      expect(res.status).toBe(303);
      const show = `/escalated/agent/tickets/${ticket.referenceNumber}`;
      expect(res.headers.get('location')).toBe(show);
      const next = await page(base, show, {
        headers: { ...v1.headers, cookie: cookieFrom(res) },
      });
      expect(next.props.flash.success).toContain('Ticket snoozed until');
      expect(new Date((await reload(ticket)).snoozedUntil).getTime()).toBe(until.getTime());
    });

    it('rejects a snooze time in the past', async () => {
      const ticket = await make();
      const show = `/escalated/agent/tickets/${ticket.referenceNumber}`;

      const res = await post(ticket, 'snooze', { snoozed_until: hours(-1).toISOString() });

      expect(res.status).toBe(303);
      const next = await page(base, show, {
        headers: { ...v1.headers, cookie: cookieFrom(res) },
      });
      expect(Object.keys(next.props.errors)).toEqual(['snoozed_until']);
      expect((await reload(ticket)).snoozedUntil).toBeNull();
    });

    it('rejects a missing or unreadable snooze time', async () => {
      const ticket = await make();
      for (const body of [{}, { snoozed_until: 'soon' }]) {
        const res = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}/snooze`, {
          body,
          headers: { 'x-requested-with': 'XMLHttpRequest' },
        });
        expect(res.status).toBe(422);
        expect((await res.json()).errors).toHaveProperty('snoozed_until');
      }
      expect((await reload(ticket)).snoozedUntil).toBeNull();
    });

    it('lets an agent unsnooze a ticket and leaves its status alone', async () => {
      const ticket = await make({ statusId: inProgress.id });
      await post(ticket, 'snooze', { snoozed_until: hours(24).toISOString() });

      const res = await post(ticket, 'unsnooze', {});

      expect(res.status).toBe(303);
      const after = await reload(ticket);
      expect(after.snoozedUntil).toBeNull();
      expect(after.statusId).toBe(inProgress.id);
    });

    it('does not let a customer snooze through the agent panel', async () => {
      const ticket = await make();
      const res = await post(
        ticket,
        'snooze',
        { snoozed_until: hours(24).toISOString() },
        'customer',
      );
      expect(res.status).toBe(403);
      expect((await reload(ticket)).snoozedUntil).toBeNull();
    });

    it('still snoozes over the JSON API by numeric id with snoozedUntil', async () => {
      const ticket = await make();
      const until = hours(5);
      const res = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}/snooze`, {
        body: { snoozedUntil: until.toISOString() },
      });
      expect(res.status).toBe(201);
      expect(new Date((await res.json()).snoozedUntil).getTime()).toBe(until.getTime());
      const unsnoozed = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}/unsnooze`, {
        method: 'POST',
      });
      expect(unsnoozed.status).toBe(201);
      expect((await unsnoozed.json()).snoozedUntil).toBeNull();
    });

    it('maps the agent snooze routes to the ticket edit permission', () => {
      expect(mappedPermissions('POST', '/escalated/agent/tickets/ESC-1/snooze')).toEqual([
        'ticket.edit',
      ]);
      expect(mappedPermissions('POST', '/escalated/agent/tickets/ESC-1/unsnooze')).toEqual([
        'ticket.edit',
      ]);
    });
  });
});

describe('agent workspace under department visibility', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let make: ReturnType<typeof maker>;
  let support: Department;
  let billing: Department;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: { enabled: true, version: 'v1' },
      visibility: 'department',
      ticketAccess: {
        resolveUser: async (id: any) => ({ id, isAgent: true, isAdmin: id === ADMIN }),
      },
    } as any));
    const open = await source
      .getRepository(TicketStatus)
      .save({ name: 'Open', slug: 'open', isDefault: true });
    make = maker(source, () => open);
    const departments = source.getRepository(Department);
    support = await departments.save({ name: 'Support', slug: 'support' });
    billing = await departments.save({ name: 'Billing', slug: 'billing' });
    const profiles = source.getRepository(AgentProfile);
    await profiles.save({ userId: AGENT, displayName: 'Ada Agent', departments: [support] });
    await profiles.save({ userId: OTHER_AGENT, displayName: 'Otto Other', departments: [billing] });
    await profiles.save({ userId: ADMIN, displayName: 'Al Admin' });
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await source.getRepository(Ticket).createQueryBuilder().delete().execute();
  });

  it('leaves out agents who cannot see the ticket', async () => {
    const ticket = await make({ departmentId: support.id });
    const names = (await showProps(base, ticket)).agents.map((a: any) => a.name);
    expect(names).toContain('Ada Agent');
    expect(names).toContain('Al Admin');
    expect(names).not.toContain('Otto Other');
  });

  it('only lists requester tickets the agent may see', async () => {
    await make({ departmentId: support.id, subject: 'Visible' });
    await make({ departmentId: billing.id, subject: 'Hidden' });
    const ticket = await make({ departmentId: support.id });

    const recent = (await showProps(base, ticket)).ticket.requester_tickets;

    expect(recent.map((t: any) => t.subject)).toEqual(['Visible']);
  });

  it('does not let an agent snooze a ticket outside their departments', async () => {
    const ticket = await make({ departmentId: billing.id });
    const res = await apiFetch(base, `/escalated/agent/tickets/${ticket.referenceNumber}/snooze`, {
      body: { snoozed_until: hours(24).toISOString() },
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(res.status).toBe(404);
    // The screen gets the port's usual answer to a ticket it cannot see:
    // back, with the error flashed.
    const show = `/escalated/agent/tickets/${ticket.referenceNumber}`;
    const screen = await inertiaFetch(base, `${show}/snooze`, {
      body: { snoozed_until: hours(24).toISOString() },
      headers: { referer: `${base}/escalated/agent/tickets` },
    });
    expect(screen.status).toBe(303);
    const row = await source.getRepository(Ticket).findOneByOrFail({ id: ticket.id });
    expect(row.snoozedUntil).toBeNull();
  });
});
