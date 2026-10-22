import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Contact,
  Department,
  Reply,
  SatisfactionRating,
  Ticket,
  TicketStatus,
} from '../../src/entities';
import { GuestOutbox } from './guest-codes';
import { AGENT, bootUi, cookieFrom, expectManifestProps } from './ui-harness';

jest.setTimeout(60000);

let seq = 0;
const uniqueEmail = () => `guest.${Date.now()}.${++seq}@example.com`;

/**
 * The guest screens over real HTTP and SQLite: `Escalated/Guest/Create` files
 * a ticket with an emailed code and lands on `Escalated/Guest/Show` through an
 * expiring grant, as escalated-laravel's Guest\TicketController does.
 */
describe('guest screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let closed: TicketStatus;
  let support: Department;
  const outbox = new GuestOutbox();

  /** A request from a guest's browser: no host user, made by the Inertia client. */
  const guest = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'manual',
      headers: {
        'x-inertia': 'true',
        'x-requested-with': 'XMLHttpRequest',
        accept: 'text/html, application/xhtml+xml',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const guestPage = async (path: string, cookie = '') => {
    const res = await guest(path, undefined, cookie ? { cookie } : {});
    expect(res.status).toBe(200);
    return res.json();
  };

  /** Files a ticket through the Create screen and returns the Show URL it lands on. */
  const fileTicket = async (email = uniqueEmail(), extra: Record<string, unknown> = {}) => {
    const proof = await outbox.proof(`${base}/escalated/guest`, email, 'ticket');
    const res = await guest(
      '/escalated/guest',
      {
        guest_name: 'Grace Guest',
        guest_email: email,
        subject: 'My order is late',
        description: 'Order 1234 has not arrived.',
        priority: 'high',
        department_id: support.id,
        ...proof,
        ...extra,
      },
      { referer: `${base}/escalated/guest/create` },
    );
    expect(res.status).toBe(303);
    return { res, email, location: res.headers.get('location')! };
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({ guestAccess: outbox.options() }));
    open = await source
      .getRepository(TicketStatus)
      .save({ name: 'Open', slug: 'open', isDefault: true });
    closed = await source
      .getRepository(TicketStatus)
      .save({ name: 'Closed', slug: 'closed', isClosed: true });
    support = await source.getRepository(Department).save({ name: 'Support', slug: 'support' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves Guest/Create with the verification and lookup URLs', async () => {
    const result = await guestPage('/escalated/guest/create');
    expect(result.component).toBe('Escalated/Guest/Create');
    expectManifestProps(result);
    expect(result.props).toMatchObject({
      verification_url: '/escalated/guest/verification',
      lookup_url: '/escalated/guest/lookup',
      priorities: ['low', 'medium', 'high', 'urgent'],
    });
    expect(result.props.departments).toContainEqual({ id: support.id, name: 'Support' });
    expect(result.props.auth.user).toBeNull();
  });

  it('files a verified ticket and opens it through the grant', async () => {
    const { res, email, location } = await fileTicket();
    expect(location).toMatch(/^\/escalated\/guest\/[A-Za-z0-9_-]{40,}$/);

    const ticket = await source
      .getRepository(Ticket)
      .findOneOrFail({ where: { subject: 'My order is late' }, order: { id: 'DESC' } });
    expect(ticket).toMatchObject({ priority: 'high', departmentId: support.id, channel: 'web' });
    const contact = await source.getRepository(Contact).findOneByOrFail({ id: ticket.contactId });
    expect(contact.email).toBe(email);

    const shown = await guestPage(location, cookieFrom(res));
    expect(shown.component).toBe('Escalated/Guest/Show');
    expectManifestProps(shown);
    expect(shown.props.flash.success).toMatch(/submitted/);
    expect(shown.props.token).toBe(location.split('/').pop());
    expect(shown.props.ticket).toMatchObject({
      reference: ticket.referenceNumber,
      subject: 'My order is late',
      description: 'Order 1234 has not arrived.',
      status: 'open',
      priority: 'high',
      department: { name: 'Support' },
      replies: [],
      attachments: [],
      satisfaction_rating: null,
      guest_access_expires_at: expect.any(String),
    });
    expect(shown.props.ticket).not.toHaveProperty('assignee');
  });

  it('refuses a ticket without the emailed code', async () => {
    const res = await guest(
      '/escalated/guest',
      {
        guest_name: 'No Code',
        guest_email: uniqueEmail(),
        subject: 'Hi',
        description: 'Hello',
        verification_id: 'nope',
        verification_code: '000000',
      },
      { referer: `${base}/escalated/guest/create` },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/escalated/guest/create');
    const next = await guestPage('/escalated/guest/create', cookieFrom(res));
    expect(Object.keys(next.props.errors)).toEqual(['verification_code']);
  });

  it('sends missing fields back with errors', async () => {
    const res = await guest(
      '/escalated/guest',
      { guest_name: '', guest_email: 'x@example.com' },
      { referer: `${base}/escalated/guest/create` },
    );
    const next = await guestPage('/escalated/guest/create', cookieFrom(res));
    expect(Object.keys(next.props.errors)).toEqual(['guest_name']);
  });

  it('lets the guest reply, shows staff replies, and refuses replies once closed', async () => {
    const { location } = await fileTicket();
    const ticket = await source
      .getRepository(Ticket)
      .findOneOrFail({ where: {}, order: { id: 'DESC' } });

    const replied = await guest(
      `${location}/reply`,
      { body: 'Any news?' },
      {
        referer: `${base}${location}`,
      },
    );
    expect(replied.status).toBe(303);
    expect(replied.headers.get('location')).toBe(location);
    await source.getRepository(Reply).save({
      ticketId: ticket.id,
      userId: AGENT,
      body: 'Shipped today.',
      type: 'reply',
    });
    await source.getRepository(Reply).save({
      ticketId: ticket.id,
      userId: AGENT,
      body: 'Internal only',
      type: 'note',
      isInternal: true,
    });

    const shown = await guestPage(location);
    const bodies = shown.props.ticket.replies.map((r: any) => [r.body, r.author.name]);
    expect(bodies).toContainEqual(['Any news?', 'You']);
    expect(bodies).toContainEqual(['Shipped today.', 'Support']);
    expect(JSON.stringify(shown.props.ticket)).not.toContain('Internal only');

    await source.getRepository(Ticket).update(ticket.id, { statusId: closed.id });
    const refused = await guest(
      `${location}/reply`,
      { body: 'Hello?' },
      {
        referer: `${base}${location}`,
      },
    );
    const after = await guestPage(location, cookieFrom(refused));
    expect(after.props.flash.error).toBe('This ticket is closed.');
  });

  it('rates a closed ticket once', async () => {
    const { location } = await fileTicket();
    const ticket = await source
      .getRepository(Ticket)
      .findOneOrFail({ where: {}, order: { id: 'DESC' } });

    const early = await guest(`${location}/rate`, { rating: 5 }, { referer: `${base}${location}` });
    expect((await guestPage(location, cookieFrom(early))).props.flash.error).toMatch(/resolved/);

    await source.getRepository(Ticket).update(ticket.id, { statusId: closed.id });
    const rated = await guest(
      `${location}/rate`,
      { rating: 4, comment: 'Quick' },
      {
        referer: `${base}${location}`,
      },
    );
    expect(rated.status).toBe(303);
    const shown = await guestPage(location, cookieFrom(rated));
    expect(shown.props.flash.success).toMatch(/Thank you/);
    expect(shown.props.ticket.satisfaction_rating).toEqual({ rating: 4, comment: 'Quick' });

    const twice = await guest(`${location}/rate`, { rating: 1 }, { referer: `${base}${location}` });
    expect((await guestPage(location, cookieFrom(twice))).props.flash.error).toMatch(/already/);
    expect(await source.getRepository(SatisfactionRating).countBy({ ticketId: ticket.id })).toBe(1);
  });

  it('refuses a link that is not an active grant', async () => {
    const res = await guest('/escalated/guest/not-a-real-grant-token-at-all-0123456789abcdef');
    expect(res.status).toBe(403);
    const reply = await guest('/escalated/guest/not-a-real-grant/reply', { body: 'x' });
    expect(reply.status).toBe(403);
    expect(await source.getRepository(Reply).countBy({ body: 'x' })).toBe(0);
  });

  it('refuses a guest form another site posts', async () => {
    const res = await fetch(`${base}/escalated/guest`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', accept: 'text/html' },
      body: JSON.stringify({ guest_name: 'X' }),
    });
    expect(res.status).toBe(403);
  });

  it('keeps the guest JSON routes', async () => {
    const res = await fetch(`${base}/escalated/guest/verification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail(), purpose: 'lookup' }),
    });
    expect(res.status).toBe(202);
  });

  it('names every route the guest screens call', async () => {
    const result = await guestPage('/escalated/guest/create');
    const routes = Object.keys(result.props.ziggy.routes);
    for (const name of [
      'escalated.guest.tickets.create',
      'escalated.guest.tickets.store',
      'escalated.guest.tickets.show',
      'escalated.guest.tickets.reply',
      'escalated.guest.tickets.rate',
    ]) {
      expect(routes).toContain(name);
    }
    expect(open.id).toBeGreaterThan(0);
  });
});
