import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { AgentProfile } from '../../src/entities/agent-profile.entity';
import { ChatSession } from '../../src/entities/chat-session.entity';
import { Department } from '../../src/entities/department.entity';
import { KbArticle } from '../../src/entities/kb-article.entity';
import { KbCategory } from '../../src/entities/kb-category.entity';
import { SatisfactionRating } from '../../src/entities/satisfaction-rating.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { ChatSessionService } from '../../src/services/chat-session.service';
import { GuestOutbox } from './guest-codes';

jest.setTimeout(60000);

/**
 * Drives the real module against SQLite with the exact requests the shared
 * widget (`@escalated-dev/escalated`, EscalatedWidget.vue) sends, and checks
 * the fields it reads.
 */
describe('shared widget API contract', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let sales: Department;
  const outbox = new GuestOutbox();
  /** The proof fields the widget sends after the guest enters the emailed code. */
  const proof = (email: string, purpose: 'ticket' | 'chat' | 'lookup') =>
    outbox.proof(`${base}/escalated/widget`, email, purpose);

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/escalated/widget${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };

  beforeEach(async () => {
    const moduleRef = await bootEscalatedModule({
      escalated: { enableWebsockets: false, guestAccess: outbox.options() },
    });
    source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();

    sales = await source.getRepository(Department).save({ name: 'Sales', slug: 'sales' });
    await source
      .getRepository(Department)
      .save({ name: 'Retired', slug: 'retired', isActive: false });
    const billing = await source
      .getRepository(KbCategory)
      .save({ name: 'Billing', slug: 'billing' });
    await source.getRepository(KbArticle).save([
      {
        title: 'Resetting your password',
        slug: 'resetting-your-password',
        content: '<p>Open <strong>Settings</strong> and choose Reset password.</p>',
        status: 'published',
        categoryId: billing.id,
      },
      {
        title: 'Reset draft',
        slug: 'reset-draft',
        content: 'Not public yet.',
        status: 'draft',
      },
    ]);

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /config', () => {
    it('asks for email verification and turns the Status tab on', async () => {
      const { status, data } = await call('GET', '/config');

      expect(status).toBe(200);
      expect(data).toMatchObject({
        guest_verification_required: true,
        status_lookup_enabled: true,
        accepts_metadata: true,
        departments: [{ id: sales.id, name: 'Sales' }],
      });
    });
  });

  describe('knowledge base', () => {
    it('searches published articles at /articles', async () => {
      const { status, data } = await call('GET', `/articles?q=${encodeURIComponent('reset')}`);

      expect(status).toBe(200);
      expect(data).toEqual({
        articles: [
          {
            title: 'Resetting your password',
            slug: 'resetting-your-password',
            excerpt: 'Open Settings and choose Reset password.',
          },
        ],
      });
    });

    it('returns no articles for a query shorter than two characters', async () => {
      const { status, data } = await call('GET', '/articles?q=r');

      expect(status).toBe(200);
      expect(data).toEqual({ articles: [] });
    });

    it('reads one article at /articles/:slug', async () => {
      const { status, data } = await call('GET', '/articles/resetting-your-password');

      expect(status).toBe(200);
      expect(data).toEqual({
        title: 'Resetting your password',
        slug: 'resetting-your-password',
        body: '<p>Open <strong>Settings</strong> and choose Reset password.</p>',
        category: 'Billing',
      });
    });

    it('answers 404 for a draft or unknown article', async () => {
      expect((await call('GET', '/articles/reset-draft')).status).toBe(404);
      expect((await call('GET', '/articles/nope')).status).toBe(404);
    });

    it('keeps the kb/ routes working', async () => {
      const search = await call('GET', '/kb/search?q=reset');
      expect(search.status).toBe(200);
      expect(Array.isArray(search.data)).toBe(true);
      expect((await call('GET', '/kb/articles/resetting-your-password')).status).toBe(200);
    });
  });

  describe('POST /tickets', () => {
    const ticketBody = async () => ({
      name: 'Jane Doe',
      email: 'jane@example.com',
      subject: 'Order missing',
      description: 'It never arrived.',
      department_id: sales.id,
      metadata: { order: 'A-100' },
      ...(await proof('jane@example.com', 'ticket')),
    });

    it('returns the reference at the top level and files the ticket in the department', async () => {
      const { status, data } = await call('POST', '/tickets', await ticketBody());

      expect(status).toBe(201);
      const ticket = await source.getRepository(Ticket).findOneByOrFail({});
      expect(data).toMatchObject({
        message: expect.any(String),
        reference: ticket.referenceNumber,
        ticket_reference: ticket.referenceNumber,
        guest_access_token: expect.any(String),
        expires_at: expect.any(String),
      });
      expect(ticket.departmentId).toBe(sales.id);
      expect(ticket.metadata).toEqual({ order: 'A-100' });
    });

    it('rejects an unknown or inactive department with a field error', async () => {
      const body = await ticketBody();
      for (const departmentId of [9999, sales.id + 1]) {
        const { status, data } = await call('POST', '/tickets', {
          ...body,
          department_id: departmentId,
        });
        expect(status).toBe(422);
        expect(data.errors.department_id).toEqual([expect.any(String)]);
      }
      expect(await source.getRepository(Ticket).count()).toBe(0);
    });

    it('treats an empty department as none', async () => {
      const { status } = await call('POST', '/tickets', {
        ...(await ticketBody()),
        department_id: null,
      });

      expect(status).toBe(201);
      expect((await source.getRepository(Ticket).findOneByOrFail({})).departmentId).toBeNull();
    });
  });

  describe('live chat', () => {
    const startChat = async (extra: Record<string, unknown> = {}) =>
      call('POST', '/chat/start', {
        name: 'John Smith',
        email: 'john@example.com',
        department_id: sales.id,
        message: 'Hi, is anyone there?',
        ...(await proof('john@example.com', 'chat')),
        ...extra,
      });

    it('reports availability with department_id', async () => {
      const { status, data } = await call('GET', `/chat/availability?department_id=${sales.id}`);

      expect(status).toBe(200);
      expect(data.available).toBe(true);
    });

    it('starts a chat keyed by an unguessable token in the department', async () => {
      const { status, data } = await startChat();

      expect(status).toBe(201);
      expect(typeof data.id).toBe('string');
      expect(data.id).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(data.status).toBe('waiting');
      const session = await source.getRepository(ChatSession).findOneByOrFail({});
      expect(data.session_id).toBe(session.id);
      expect(session.departmentId).toBe(sales.id);
      // Only a hash of the token is stored.
      expect(JSON.stringify(session)).not.toContain(data.id);
    });

    it('rejects an unknown department when starting a chat', async () => {
      const { status, data } = await startChat({ department_id: 9999 });

      expect(status).toBe(422);
      expect(data.errors.department_id).toBeDefined();
    });

    it('exchanges messages through /chat/:id/messages', async () => {
      const { data: chat } = await startChat();

      const first = await call('GET', `/chat/${chat.id}/messages`);
      expect(first.status).toBe(200);
      expect(first.data).toMatchObject({ typing: null, agent: null, ended: false });
      expect(first.data.messages).toEqual([
        {
          id: expect.anything(),
          body: 'Hi, is anyone there?',
          is_agent: false,
          author: { name: 'John Smith' },
          created_at: expect.any(String),
        },
      ]);

      const sent = await call('POST', `/chat/${chat.id}/messages`, { body: 'Order A-100' });
      expect(sent.status).toBeLessThan(300);

      const session = await source.getRepository(ChatSession).findOneByOrFail({});
      await source
        .getRepository(AgentProfile)
        .save({ userId: 7, displayName: 'Alex Agent', isActive: true });
      const chats = app.get(ChatSessionService);
      await chats.accept(session.id, 7);
      await chats.sendMessage(session.id, 'Happy to help!', 7, 'agent');

      const after = await call('GET', `/chat/${chat.id}/messages`);
      expect(after.data.agent).toEqual({ name: 'Alex Agent' });
      expect(after.data.messages.map((m: any) => [m.body, m.is_agent, m.author.name])).toEqual([
        ['Hi, is anyone there?', false, 'John Smith'],
        ['Order A-100', false, 'John Smith'],
        ['Happy to help!', true, 'Alex Agent'],
      ]);
    });

    it('rejects an empty message', async () => {
      const { data: chat } = await startChat();

      const { status, data } = await call('POST', `/chat/${chat.id}/messages`, { body: '  ' });
      expect(status).toBe(422);
      expect(data.errors.body).toBeDefined();
    });

    it('accepts the typing signal', async () => {
      const { data: chat } = await startChat();

      expect((await call('POST', `/chat/${chat.id}/typing`)).status).toBeLessThan(300);
    });

    it('ends and rates a chat', async () => {
      const { data: chat } = await startChat();

      const early = await call('POST', `/chat/${chat.id}/rate`, { rating: 5 });
      expect(early.status).toBe(422);

      expect((await call('POST', `/chat/${chat.id}/end`)).status).toBeLessThan(300);
      expect((await call('GET', `/chat/${chat.id}/messages`)).data.ended).toBe(true);
      expect((await call('POST', `/chat/${chat.id}/messages`, { body: 'hi' })).status).toBe(422);

      const bad = await call('POST', `/chat/${chat.id}/rate`, { rating: 9 });
      expect(bad.status).toBe(422);
      expect(bad.data.errors.rating).toBeDefined();

      const rated = await call('POST', `/chat/${chat.id}/rate`, {
        rating: 4,
        comment: 'Quick answer',
      });
      expect(rated.status).toBeLessThan(300);
      const session = await source.getRepository(ChatSession).findOneByOrFail({});
      expect(
        await source.getRepository(SatisfactionRating).findOneByOrFail({
          ticketId: session.ticketId,
        }),
      ).toMatchObject({ rating: 4, comment: 'Quick answer' });

      expect((await call('POST', `/chat/${chat.id}/rate`, { rating: 5 })).status).toBe(422);
    });

    it('answers 404 for an unknown token or a numeric session id', async () => {
      await startChat();
      const session = await source.getRepository(ChatSession).findOneByOrFail({});

      for (const id of ['not-a-real-token', String(session.id)]) {
        expect((await call('GET', `/chat/${id}/messages`)).status).toBe(404);
        expect((await call('POST', `/chat/${id}/messages`, { body: 'x' })).status).toBe(404);
        expect((await call('POST', `/chat/${id}/typing`)).status).toBe(404);
        expect((await call('POST', `/chat/${id}/end`)).status).toBe(404);
        expect((await call('POST', `/chat/${id}/rate`, { rating: 5 })).status).toBe(404);
      }
      expect((await source.getRepository(ChatSession).findOneByOrFail({})).status).toBe('waiting');
    });
  });
});
