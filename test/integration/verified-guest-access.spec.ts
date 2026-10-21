import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { GuestOutbox } from './guest-codes';
import { Contact, GuestVerification, Ticket, TicketStatus } from '../../src/entities';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

jest.setTimeout(60000);

/**
 * Verified guest access over real HTTP + SQLite (docs/guest-access.md, after
 * escalated-laravel): emailed codes, expiring grants, lookup, and the widget
 * and guest routes that use them.
 */

const agentGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.headers['x-role'] !== 'agent') return false;
    req.user = { id: 21 };
    return true;
  },
};

let seq = 0;
const uniqueEmail = (label = 'guest') => `${label}.${Date.now()}.${++seq}@Example.com`;

async function start(outbox: GuestOutbox, extra: Partial<EscalatedModuleOptions> = {}) {
  const moduleRef = await bootEscalatedModule({
    escalated: {
      agentGuard,
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
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('verified guest access', () => {
  const outbox = new GuestOutbox();
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let widget: string;
  let guest: string;

  const createTicket = async (email = uniqueEmail()) => {
    const proof = await outbox.proof(widget, email, 'ticket');
    const res = await post(`${widget}/tickets`, {
      name: 'Guest',
      email,
      subject: 'Where is my order?',
      description: 'It has not arrived.',
      ...proof,
    });
    expect(res.status).toBe(201);
    return { email, ...(await res.json()) };
  };

  beforeAll(async () => {
    ({ app, source, base } = await start(outbox));
    widget = `${base}/escalated/widget`;
    guest = `${base}/escalated/guest`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('advertises verification and status lookup in the widget config', async () => {
    const config = await (await fetch(`${widget}/config`)).json();
    expect(config).toMatchObject({
      guest_verification_required: true,
      status_lookup_enabled: true,
    });
  });

  describe('codes', () => {
    it('emails an eight-digit code and answers only with its id', async () => {
      const email = uniqueEmail();
      const res = await post(`${widget}/verification`, { email, purpose: 'ticket' });
      expect(res.status).toBe(202);
      expect(res.headers.get('cache-control')).toContain('no-store');
      const body = await res.json();
      expect(body).toEqual({
        verification_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expires_in: 600,
        message: expect.any(String),
      });
      expect(outbox.codeFor(email)).toMatch(/^\d{8}$/);
      expect(JSON.stringify(body)).not.toContain(outbox.codeFor(email));

      // Neither the code nor the address is stored in the clear.
      const row = await source
        .getRepository(GuestVerification)
        .findOneByOrFail({ id: body.verification_id });
      expect(JSON.stringify(row)).not.toContain(outbox.codeFor(email));
      expect(JSON.stringify(row).toLowerCase()).not.toContain(email.toLowerCase());
    });

    it('refuses a bad email or purpose', async () => {
      const bad = await post(`${widget}/verification`, { email: 'nope', purpose: 'ticket' });
      expect(bad.status).toBe(422);
      expect((await bad.json()).errors.email).toBeDefined();
      const purpose = await post(`${widget}/verification`, {
        email: uniqueEmail(),
        purpose: 'admin',
      });
      expect(purpose.status).toBe(422);
    });

    it('limits codes per mailbox and client with Retry-After', async () => {
      const email = uniqueEmail('budget');
      for (let i = 0; i < 3; i++) {
        expect((await post(`${widget}/verification`, { email, purpose: 'ticket' })).status).toBe(
          202,
        );
      }
      const over = await post(`${guest}/verification`, { email, purpose: 'lookup' });
      expect(over.status).toBe(429);
      expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    });
  });

  describe('widget tickets', () => {
    it('needs proof to create a guest ticket', async () => {
      const res = await post(`${widget}/tickets`, {
        email: uniqueEmail(),
        subject: 's',
        description: 'd',
      });
      expect(res.status).toBe(422);
      expect((await res.json()).errors.verification_code).toBeDefined();
      expect(await source.getRepository(Ticket).count()).toBe(0);
    });

    it('creates the ticket with a code and answers with an expiring grant', async () => {
      const created = await createTicket();
      expect(created).toMatchObject({
        reference: expect.any(String),
        ticket_reference: created.reference,
        guest_access_token: expect.any(String),
        expires_at: expect.any(String),
      });
      expect(created.ticket).toBeUndefined();
      const expires = new Date(created.expires_at).getTime() - Date.now();
      expect(expires).toBeGreaterThan(23 * 3600_000);
      expect(expires).toBeLessThanOrEqual(24 * 3600_000);

      const ticket = await source
        .getRepository(Ticket)
        .findOneByOrFail({ referenceNumber: created.reference });
      // Only the nonce's hash is stored, and the permanent token is cleared.
      expect(ticket.guestAccessHash).toMatch(/^[0-9a-f]{64}$/);
      expect(created.guest_access_token).not.toContain(ticket.guestAccessHash);
      expect(ticket.guestAccessToken).toBeNull();
    });

    it('spends a code once', async () => {
      const email = uniqueEmail();
      const proof = await outbox.proof(widget, email, 'ticket');
      const body = { email, subject: 's', description: 'd', ...proof };
      expect((await post(`${widget}/tickets`, body)).status).toBe(201);
      expect((await post(`${widget}/tickets`, body)).status).toBe(422);
    });

    it('binds a code to its email and purpose, and allows five guesses', async () => {
      const email = uniqueEmail();
      const chatProof = await outbox.proof(widget, email, 'chat');
      expect(
        (await post(`${widget}/tickets`, { email, subject: 's', description: 'd', ...chatProof }))
          .status,
      ).toBe(422);

      const proof = await outbox.proof(widget, email, 'ticket');
      const other = uniqueEmail();
      expect(
        (
          await post(`${widget}/tickets`, {
            email: other,
            subject: 's',
            description: 'd',
            ...proof,
          })
        ).status,
      ).toBe(422);
      for (let i = 0; i < 3; i++) {
        await post(`${widget}/tickets`, {
          email,
          subject: 's',
          description: 'd',
          verification_id: proof.verification_id,
          verification_code: '00000000',
        });
      }
      // Five guesses used (one wrong email, three wrong codes, and this one).
      const res = await post(`${widget}/tickets`, {
        email,
        subject: 's',
        description: 'd',
        ...proof,
      });
      expect(res.status).toBe(201);

      // A sixth guess fails even with the right code. (Another mailbox: the
      // public submit limit allows ten tickets per email per hour.)
      const next = uniqueEmail();
      const again = await outbox.proof(widget, next, 'ticket');
      for (let i = 0; i < 5; i++) {
        await post(`${widget}/tickets`, {
          email: next,
          subject: 's',
          description: 'd',
          verification_id: again.verification_id,
          verification_code: '11111111',
        });
      }
      expect(
        (
          await post(`${widget}/tickets`, {
            email: next,
            subject: 's',
            description: 'd',
            ...again,
          })
        ).status,
      ).toBe(422);
    });

    it('refuses an expired code', async () => {
      const email = uniqueEmail();
      const proof = await outbox.proof(widget, email, 'ticket');
      await source
        .getRepository(GuestVerification)
        .update(proof.verification_id, { expiresAt: new Date(Date.now() - 1000) });
      expect(
        (await post(`${widget}/tickets`, { email, subject: 's', description: 'd', ...proof }))
          .status,
      ).toBe(422);
    });
  });

  describe('grants', () => {
    it('open the ticket they name, by reference, with a bearer header', async () => {
      const { reference, guest_access_token: token } = await createTicket();
      const res = await fetch(`${widget}/tickets/${encodeURIComponent(reference)}`, {
        headers: bearer(token),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      const status = await res.json();
      expect(status).toMatchObject({
        reference,
        subject: 'Where is my order?',
        status: 'open',
        status_label: 'Open',
        status_color: '#22c55e',
        replies: [],
      });
      expect(JSON.stringify(status)).not.toMatch(/guestAccess|metadata|contact/i);

      const reply = await post(
        `${widget}/tickets/${reference}/replies`,
        { body: 'Any news?' },
        bearer(token),
      );
      expect(reply.status).toBe(201);
      const after = await (
        await fetch(`${widget}/tickets/${reference}`, { headers: bearer(token) })
      ).json();
      expect(after.replies.map((r: { body: string }) => r.body)).toEqual(['Any news?']);

      // The same grant works on the guest routes.
      expect(
        (await fetch(`${guest}/tickets/${reference}`, { headers: bearer(token) })).status,
      ).toBe(200);
    });

    it('do not open another ticket, and nothing opens without one', async () => {
      const first = await createTicket();
      const second = await createTicket();
      expect(
        (
          await fetch(`${widget}/tickets/${second.reference}`, {
            headers: bearer(first.guest_access_token),
          })
        ).status,
      ).toBe(403);
      expect((await fetch(`${widget}/tickets/${first.reference}`)).status).toBe(403);
      expect(
        (
          await fetch(
            `${widget}/tickets/${first.reference}?email=${encodeURIComponent(first.email)}`,
          )
        ).status,
      ).toBe(403);
    });

    it('expire', async () => {
      const { reference, guest_access_token: token } = await createTicket();
      await source
        .getRepository(Ticket)
        .update(
          { referenceNumber: reference },
          { guestAccessExpiresAt: new Date(Date.now() - 1000) },
        );
      expect(
        (await fetch(`${widget}/tickets/${reference}`, { headers: bearer(token) })).status,
      ).toBe(403);
    });

    it('are revoked when the guest email changes', async () => {
      const { reference, email, guest_access_token: token } = await createTicket();
      await source
        .getRepository(Contact)
        .update({ email: email.toLowerCase() }, { email: uniqueEmail('moved').toLowerCase() });
      expect(
        (await fetch(`${widget}/tickets/${reference}`, { headers: bearer(token) })).status,
      ).toBe(403);
    });

    it('do not accept the permanent pre-verification token by default', async () => {
      const ticket = await source.getRepository(Ticket).save({
        referenceNumber: `OLD-${++seq}`,
        subject: 'Old',
        description: 'd',
        requesterId: 0,
        guestAccessToken: '0b6f2f8e-5a8e-4c79-9d3e-9b7b6c1d2e3f',
      } as Partial<Ticket>);
      expect(
        (
          await fetch(`${widget}/tickets/${ticket.id}`, {
            headers: { 'x-guest-token': ticket.guestAccessToken },
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('lookup', () => {
    it('renews access with a lookup code and revokes the earlier grant', async () => {
      const { reference, email, guest_access_token: old } = await createTicket();
      const proof = await outbox.proof(guest, email, 'lookup');
      const res = await post(`${guest}/lookup`, { email, reference, ...proof });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toEqual([
        {
          reference,
          subject: 'Where is my order?',
          guest_access_token: expect.any(String),
          expires_at: expect.any(String),
        },
      ]);
      expect((await fetch(`${widget}/tickets/${reference}`, { headers: bearer(old) })).status).toBe(
        403,
      );
      expect(
        (
          await fetch(`${widget}/tickets/${reference}`, {
            headers: bearer(data[0].guest_access_token),
          })
        ).status,
      ).toBe(200);
    });

    it('finds nothing for another email, and spends the code anyway', async () => {
      const { reference } = await createTicket();
      const stranger = uniqueEmail('stranger');
      const proof = await outbox.proof(widget, stranger, 'lookup');
      const res = await post(`${widget}/lookup`, { email: stranger, reference, ...proof });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual([]);
      expect(
        (await post(`${widget}/lookup`, { email: stranger, reference, ...proof })).status,
      ).toBe(422);
    });

    it('needs proof', async () => {
      const { reference, email } = await createTicket();
      expect((await post(`${widget}/lookup`, { email, reference })).status).toBe(422);
    });
  });

  describe('widget chat', () => {
    it('needs a chat code to start', async () => {
      const email = uniqueEmail('chat');
      expect((await post(`${widget}/chat/start`, { name: 'V', email })).status).toBe(422);
      const proof = await outbox.proof(widget, email, 'chat');
      const res = await post(`${widget}/chat/start`, { name: 'V', email, message: 'Hi', ...proof });
      expect(res.status).toBe(201);
      expect((await res.json()).id).toEqual(expect.any(String));
    });
  });
});

describe('verified guest access options', () => {
  it('throttles widget chat starts per client', async () => {
    const outbox = new GuestOutbox();
    const { app, base } = await start(outbox, { guestRateLimit: { chatsPerMinute: 2 } });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await post(`${base}/escalated/widget/chat/start`, { name: 'V' })).status);
      }
      expect(statuses).toEqual([422, 422, 429]);
    } finally {
      await app.close();
    }
  });

  it('keeps permanent tokens working with guestAccess.legacyTokens', async () => {
    const outbox = new GuestOutbox();
    const { app, base, source } = await start(outbox, { guestAccess: { legacyTokens: true } });
    try {
      const ticket = await source.getRepository(Ticket).save({
        referenceNumber: 'LEGACY-1',
        subject: 'Old',
        description: 'd',
        requesterId: 0,
        guestAccessToken: '0b6f2f8e-5a8e-4c79-9d3e-9b7b6c1d2e3f',
      } as Partial<Ticket>);
      const res = await fetch(`${base}/escalated/widget/tickets/${ticket.id}`, {
        headers: { 'x-guest-token': ticket.guestAccessToken },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).reference).toBe('LEGACY-1');
    } finally {
      await app.close();
    }
  });
});
