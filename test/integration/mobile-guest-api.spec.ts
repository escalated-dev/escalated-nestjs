import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { GuestOutbox } from './guest-codes';
import { Contact, Department, Reply, Ticket, TicketStatus } from '../../src/entities';
import { ReplyService } from '../../src/services/reply.service';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

jest.setTimeout(60000);

/**
 * The mobile guest API (escalated-developer-context
 * domain-model/mobile-guest-api.md) over real HTTP + SQLite: the same codes,
 * grants and guest budgets as the widget and guest routes, under
 * `escalated/api/v1/mobile/guest`.
 */

let seq = 0;
const uniqueEmail = (label = 'mobile') => `${label}.${Date.now()}.${++seq}@Example.com`;

async function start(outbox: GuestOutbox, extra: Partial<EscalatedModuleOptions> = {}) {
  const moduleRef = await bootEscalatedModule({
    escalated: {
      guestAccess: outbox.options(extra.guestAccess),
      guestRateLimit: {
        ticketsPerMinute: 1000,
        repliesPerMinute: 1000,
        chatsPerMinute: 1000,
        verificationsPerMinute: 1000,
        ...extra.guestRateLimit,
      },
    },
  });
  const source = moduleRef.get(DataSource);
  await source.initialize();
  await source.synchronize();
  await source
    .getRepository(TicketStatus)
    .save({ name: 'Open', slug: 'open', isDefault: true, color: '#22c55e' });
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, source, base };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const expectPrivate = (res: Response) => {
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
};

describe('mobile guest API', () => {
  const outbox = new GuestOutbox();
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let mobile: string;
  let widget: string;
  let guest: string;

  const ticketBody = (email: string, proof: object, extra: object = {}) => ({
    name: 'Mobile Guest',
    email,
    subject: 'App crashes',
    description: 'On launch.',
    ...proof,
    ...extra,
  });

  const createTicket = async (email = uniqueEmail(), extra: object = {}) => {
    const proof = await outbox.proof(mobile, email, 'ticket');
    const res = await post(`${mobile}/tickets`, ticketBody(email, proof, extra));
    expect(res.status).toBe(201);
    const body = await res.json();
    return { email, proof, ticket: body.data, body };
  };

  beforeAll(async () => {
    ({ app, source, base } = await start(outbox));
    mobile = `${base}/escalated/api/v1/mobile/guest`;
    widget = `${base}/escalated/widget`;
    guest = `${base}/escalated/guest`;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('POST guest/verification', () => {
    it('emails a code and answers 202 with private headers', async () => {
      const email = uniqueEmail();
      const res = await post(`${mobile}/verification`, { email, purpose: 'ticket' });
      expect(res.status).toBe(202);
      expectPrivate(res);
      expect(await res.json()).toEqual({
        verification_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expires_in: 600,
        message: expect.any(String),
      });
      expect(outbox.codeFor(email)).toMatch(/^\d{8}$/);
    });

    it('refuses a bad email or purpose with 422', async () => {
      const res = await post(`${mobile}/verification`, { email: 'nope', purpose: 'admin' });
      expect(res.status).toBe(422);
      expectPrivate(res);
      const body = await res.json();
      expect(body.errors.email).toBeDefined();
      expect(body.errors.purpose).toBeDefined();
    });
  });

  describe('POST guest/tickets', () => {
    it('needs proof: 422 on verification_code, and no contact or ticket', async () => {
      const email = uniqueEmail('noproof');
      const res = await post(`${mobile}/tickets`, {
        name: 'Guest',
        email,
        subject: 's',
        description: 'd',
      });
      expect(res.status).toBe(422);
      expectPrivate(res);
      expect((await res.json()).errors.verification_code).toBeDefined();

      const wrong = await post(
        `${mobile}/tickets`,
        ticketBody(email, {
          verification_id: '0b6f2f8e-5a8e-4c79-9d3e-9b7b6c1d2e3f',
          verification_code: '12345678',
        }),
      );
      expect(wrong.status).toBe(422);
      expect((await wrong.json()).errors.verification_code).toBeDefined();

      expect(await source.getRepository(Contact).countBy({ email: email.toLowerCase() })).toBe(0);
      expect(await source.getRepository(Ticket).countBy({ subject: 's' })).toBe(0);
    });

    it('validates fields before spending the code', async () => {
      const email = uniqueEmail('invalid');
      const proof = await outbox.proof(mobile, email, 'ticket');
      const res = await post(`${mobile}/tickets`, {
        email,
        subject: 'x'.repeat(256),
        description: 'd',
        priority: 'whenever',
        department_id: 9999,
        ...proof,
      });
      expect(res.status).toBe(422);
      const { errors } = await res.json();
      expect(Object.keys(errors).sort()).toEqual(
        ['department_id', 'name', 'priority', 'subject'].sort(),
      );

      // The code was not spent: a valid request with it still succeeds.
      const ok = await post(`${mobile}/tickets`, ticketBody(email, proof));
      expect(ok.status).toBe(201);
    });

    it('creates the ticket with a grant and the mobile ticket shape; the code is spent', async () => {
      const department = await source
        .getRepository(Department)
        .save({ name: 'Billing', slug: `billing-${++seq}`, isActive: true } as Partial<Department>);
      const email = uniqueEmail('create');
      const proof = await outbox.proof(mobile, email, 'ticket');
      const body = ticketBody(email, proof, {
        priority: 'critical',
        department_id: department.id,
        // Anonymous creation cannot set these; unknown fields are ignored.
        metadata: { plan: 'gold' },
        external_reference: 'EXT-1',
        status: 'closed',
        assignee_id: 7,
      });
      const res = await post(`${mobile}/tickets`, body);
      expect(res.status).toBe(201);
      expectPrivate(res);
      const json = await res.json();
      expect(json.message).toBe('Ticket created.');
      expect(json.data).toEqual({
        id: expect.any(Number),
        reference: expect.any(String),
        guest_access_token: expect.any(String),
        guest_access_expires_at: expect.any(String),
        subject: 'App crashes',
        description: 'On launch.',
        status: { value: 'open', label: 'Open' },
        priority: { value: 'critical', label: 'Critical' },
        channel: 'web',
        metadata: {},
        requester: { name: 'Mobile Guest', email: email.toLowerCase() },
        assignee: null,
        department: { id: department.id, name: 'Billing' },
        tags: [],
        replies: [],
        activities: [],
        sla: {
          first_response_due_at: null,
          first_response_at: null,
          first_response_breached: false,
          resolution_due_at: null,
          resolution_breached: false,
        },
        is_following: false,
        followers_count: 0,
        resolved_at: null,
        closed_at: null,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });

      const stored = await source.getRepository(Ticket).findOneByOrFail({ id: json.data.id });
      expect(stored.metadata).toBeNull();
      expect(stored.assigneeId).toBeNull();
      expect(stored.channel).toBe('web');
      expect(stored.guestEmailVerifiedAt).not.toBeNull();

      const reuse = await post(`${mobile}/tickets`, body);
      expect(reuse.status).toBe(422);
      expect((await reuse.json()).errors.verification_code).toBeDefined();
    });
  });

  describe('grants', () => {
    it('open GET here and on the widget and guest routes, and the other way round', async () => {
      const { ticket } = await createTicket();
      const token = ticket.guest_access_token;

      const res = await fetch(`${mobile}/tickets/${token}`);
      expect(res.status).toBe(200);
      expectPrivate(res);
      const { data } = await res.json();
      expect(data).toMatchObject({
        reference: ticket.reference,
        guest_access_token: token,
        guest_access_expires_at: ticket.guest_access_expires_at,
        replies: [],
      });

      const auth = { headers: { authorization: `Bearer ${token}` } };
      expect((await fetch(`${widget}/tickets/${ticket.reference}`, auth)).status).toBe(200);
      expect((await fetch(`${guest}/tickets/${ticket.reference}`, auth)).status).toBe(200);

      // A widget-created grant opens the mobile routes.
      const email = uniqueEmail('widget');
      const proof = await outbox.proof(widget, email, 'ticket');
      const created = await (
        await post(`${widget}/tickets`, { email, subject: 'W', description: 'd', ...proof })
      ).json();
      const shown = await fetch(`${mobile}/tickets/${created.guest_access_token}`);
      expect(shown.status).toBe(200);
      expect((await shown.json()).data.reference).toBe(created.reference);
    });

    it('renew with a mobile lookup, which revokes the earlier grant', async () => {
      const { ticket, email } = await createTicket();
      const proof = await outbox.proof(mobile, email, 'lookup');
      const res = await post(`${mobile}/lookup`, { email, reference: ticket.reference, ...proof });
      expect(res.status).toBe(200);
      expectPrivate(res);
      const { data } = await res.json();
      expect(data).toEqual([
        {
          reference: ticket.reference,
          subject: 'App crashes',
          guest_access_token: expect.any(String),
          expires_at: expect.any(String),
        },
      ]);
      expect((await fetch(`${mobile}/tickets/${ticket.guest_access_token}`)).status).toBe(404);
      expect((await fetch(`${mobile}/tickets/${data[0].guest_access_token}`)).status).toBe(200);

      const again = await post(`${mobile}/lookup`, {
        email,
        reference: ticket.reference,
        ...proof,
      });
      expect(again.status).toBe(422);
      expect((await again.json()).errors.verification_code).toBeDefined();
    });

    it('are 404 when expired, malformed, over-long or a chat token', async () => {
      const { ticket } = await createTicket();
      await source
        .getRepository(Ticket)
        .update({ id: ticket.id }, { guestAccessExpiresAt: new Date(Date.now() - 1000) });
      const expired = await fetch(`${mobile}/tickets/${ticket.guest_access_token}`);
      expect(expired.status).toBe(404);
      expectPrivate(expired);
      expect(
        (
          await post(`${mobile}/tickets/${ticket.guest_access_token}/replies`, {
            email: ticket.requester.email,
            body: 'hi',
          })
        ).status,
      ).toBe(404);

      expect((await fetch(`${mobile}/tickets/not-a-grant`)).status).toBe(404);
      expect((await fetch(`${mobile}/tickets/${'a'.repeat(3000)}`)).status).toBe(404);
      expect((await fetch(`${mobile}/tickets/${ticket.reference}`)).status).toBe(404);

      const chatEmail = uniqueEmail('chat');
      const chatProof = await outbox.proof(widget, chatEmail, 'chat');
      const chat = await (
        await post(`${widget}/chat/start`, {
          name: 'V',
          email: chatEmail,
          message: 'Hi',
          ...chatProof,
        })
      ).json();
      expect(chat.id).toEqual(expect.any(String));
      expect((await fetch(`${mobile}/tickets/${chat.id}`)).status).toBe(404);
    });
  });

  describe('POST guest/tickets/:token/replies', () => {
    it('accepts the ticket email in any case, and refuses another email', async () => {
      const { ticket, email } = await createTicket();
      const url = `${mobile}/tickets/${ticket.guest_access_token}/replies`;

      const ok = await post(url, { email: email.toUpperCase(), body: 'Thanks' });
      expect(ok.status).toBe(201);
      expectPrivate(ok);
      expect(await ok.json()).toEqual({ message: 'Reply sent.' });

      const mismatch = await post(url, { email: uniqueEmail('other'), body: 'Me too' });
      expect(mismatch.status).toBe(403);
      expect((await mismatch.json()).message).toBe(
        'The provided email does not match this ticket.',
      );

      const invalid = await post(url, { email: 'nope', body: '' });
      expect(invalid.status).toBe(422);
      const { errors } = await invalid.json();
      expect(errors.body).toBeDefined();
      expect(errors.email).toBeDefined();

      const replies = await source.getRepository(Reply).findBy({ ticketId: ticket.id });
      expect(replies.map((reply) => [reply.body, reply.isInternal])).toEqual([['Thanks', false]]);
    });

    it('is 422 on a closed ticket', async () => {
      const { ticket, email } = await createTicket();
      const closed = await source
        .getRepository(TicketStatus)
        .save({ name: 'Closed', slug: 'closed', isClosed: true, color: '#000000' });
      await source.getRepository(Ticket).update({ id: ticket.id }, { statusId: closed.id });

      const res = await post(`${mobile}/tickets/${ticket.guest_access_token}/replies`, {
        email,
        body: 'Hello?',
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ message: 'This ticket is closed.' });
    });
  });

  it('shows public replies newest first, never internal notes or staff identity', async () => {
    const { ticket, email } = await createTicket();
    const token = ticket.guest_access_token;
    const replies = app.get(ReplyService);
    // A staff id no timestamp or generated id can contain, so the leak check
    // below cannot match a created_at like "12:42:07" (it used to, at :42).
    const staffId = 987654321;

    expect(
      (await post(`${mobile}/tickets/${token}/replies`, { email, body: 'First from guest' }))
        .status,
    ).toBe(201);
    await replies.create(
      ticket.id,
      { body: 'Secret note', isInternal: true, type: 'note' },
      staffId,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await replies.create(ticket.id, { body: 'Agent answer', type: 'reply' }, staffId);

    const res = await fetch(`${mobile}/tickets/${token}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.replies).toEqual([
      {
        id: expect.any(Number),
        body: 'Agent answer',
        is_internal_note: false,
        is_pinned: false,
        author: { id: 0, name: 'Support', email: '' },
        attachments: [],
        created_at: expect.any(String),
      },
      {
        id: expect.any(Number),
        body: 'First from guest',
        is_internal_note: false,
        is_pinned: false,
        author: { id: 0, name: 'Mobile Guest', email: email.toLowerCase() },
        attachments: [],
        created_at: expect.any(String),
      },
    ]);
    const text = JSON.stringify(data);
    expect(text).not.toContain('Secret note');
    expect(text).not.toMatch(/guestAccessHash|guestVerifiedEmail|contactId|requesterId|"42"|:42\b/);
  });
});

describe('mobile guest API rate limits', () => {
  it('answers 429 with Retry-After from the shared guest budget', async () => {
    const outbox = new GuestOutbox();
    const { app, base } = await start(outbox, { guestRateLimit: { ticketsPerMinute: 2 } });
    try {
      const mobile = `${base}/escalated/api/v1/mobile/guest`;
      // The widget and mobile create routes share one per-IP budget.
      const first = await post(`${base}/escalated/widget/tickets`, { email: 'a@example.com' });
      expect(first.status).toBe(422);
      const second = await post(`${mobile}/tickets`, {});
      expect(second.status).toBe(422);
      const over = await post(`${mobile}/tickets`, {});
      expect(over.status).toBe(429);
      expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
      expectPrivate(over);
    } finally {
      await app.close();
    }
  });

  it('counts verification and lookup against the guest code budget', async () => {
    const outbox = new GuestOutbox();
    const { app, base } = await start(outbox, { guestRateLimit: { verificationsPerMinute: 2 } });
    try {
      const mobile = `${base}/escalated/api/v1/mobile/guest`;
      expect((await post(`${mobile}/verification`, {})).status).toBe(422);
      expect((await post(`${mobile}/lookup`, {})).status).toBe(422);
      const over = await post(`${mobile}/verification`, {});
      expect(over.status).toBe(429);
      expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
