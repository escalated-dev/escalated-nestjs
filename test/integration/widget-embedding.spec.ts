import { CanActivate, INestApplication, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { bootEscalatedModule } from './boot-escalated-module';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { TicketService } from '../../src/services/ticket.service';
import { ContactService } from '../../src/services/contact.service';
import { SettingsService } from '../../src/services/settings.service';
import { ChatSessionService } from '../../src/services/chat-session.service';
import { DepartmentService } from '../../src/services/department.service';
import { KnowledgeBaseService } from '../../src/services/knowledge-base.service';
import { GuestTicketsService } from '../../src/services/guest-tickets.service';
import { guestProofSkipped } from './guest-codes';

jest.setTimeout(60000);

const SHOP = 'https://shop.example.com';
const EVIL = 'https://evil.example.net';
const BUNDLE = join(__dirname, '../../assets/widget/escalated-widget.js');

/** In-memory stand-in for the settings table. */
function fakeSettings(initial: Record<string, string> = {}) {
  const rows = new Map<string, { key: string; value: string; type: string; group: string }>(
    Object.entries(initial).map(([key, value]) => [
      key,
      { key, value, type: 'string', group: 'general' },
    ]),
  );
  return {
    rows,
    get: jest.fn(
      async (key: string, fallback?: string) => rows.get(key)?.value ?? fallback ?? null,
    ),
    getTyped: jest.fn(async (key: string, fallback?: unknown) =>
      rows.has(key) ? rows.get(key)!.value : fallback,
    ),
    getAll: jest.fn(async () => [...rows.values()]),
    set: jest.fn(async (key: string, value: unknown, type = 'string', group = 'general') => {
      const row = { key, value: String(value), type, group };
      rows.set(key, row);
      return row;
    }),
    setMany: jest.fn(async (items: { key: string; value: unknown }[]) => {
      for (const item of items) rows.set(item.key, { ...item, value: String(item.value) } as any);
    }),
  };
}

function makeStubs(settings: Record<string, string>) {
  return {
    settings: fakeSettings(settings),
    tickets: {
      create: jest.fn(async (dto: Record<string, unknown>) => ({
        id: 1,
        referenceNumber: 'ESC-1',
        guestAccessToken: 'guest-token',
        ...dto,
      })),
    },
    contacts: { findOrCreateByEmail: jest.fn(async () => ({ id: 99, email: 'jane@example.com' })) },
    chat: {
      start: jest.fn(async () => ({ id: 5, ticketId: 1, status: 'waiting', visitorName: 'John' })),
      issueVisitorToken: jest.fn(async () => ({
        token: 'visitor-token',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      })),
      transcript: jest.fn(async () => ({ messages: [], agent: null, ticketReference: 'ESC-1' })),
    },
    departments: {
      findAll: jest.fn(async () => [
        { id: 1, name: 'Sales', isActive: true, slug: 'sales' },
        { id: 2, name: 'Old', isActive: false, slug: 'old' },
      ]),
    },
    kb: {
      findArticleBySlug: jest.fn(async () => {
        throw new NotFoundException('Article not found');
      }),
      searchArticles: jest.fn(async () => []),
    },
  };
}

type Stubs = ReturnType<typeof makeStubs>;

interface Running {
  app: INestApplication;
  stubs: Stubs;
  base: string;
  call: (
    method: string,
    path: string,
    init?: { headers?: Record<string, string>; body?: unknown },
  ) => Promise<Response>;
}

async function start(
  options: {
    escalated?: EscalatedModuleOptions;
    settings?: Record<string, string>;
    signedInUser?: { id: number };
  } = {},
): Promise<Running> {
  const stubs = makeStubs(options.settings ?? {});
  const moduleRef = await bootEscalatedModule({
    escalated: { widgetOrigins: [SHOP], ...options.escalated },
    configure: (builder) =>
      builder
        .overrideProvider(SettingsService)
        .useValue(stubs.settings)
        .overrideProvider(TicketService)
        .useValue(stubs.tickets)
        .overrideProvider(ContactService)
        .useValue(stubs.contacts)
        .overrideProvider(ChatSessionService)
        .useValue(stubs.chat)
        .overrideProvider(DepartmentService)
        .useValue(stubs.departments)
        .overrideProvider(KnowledgeBaseService)
        .useValue(stubs.kb)
        .overrideProvider(GuestTicketsService)
        .useValue(guestProofSkipped()),
  });

  const app = moduleRef.createNestApplication({ logger: false });
  if (options.signedInUser) {
    // Stands in for the host app's session authentication.
    app.use((req: any, _res: unknown, next: () => void) => {
      req.user = options.signedInUser;
      next();
    });
  }
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();

  return {
    app,
    stubs,
    base,
    call: (method, path, init = {}) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
  };
}

const ticketPayload = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  subject: 'Where is my order?',
  description: 'It has not arrived yet.',
};

describe('cross-origin widget embedding', () => {
  let running: Running | undefined;

  afterEach(async () => {
    await running?.app.close();
    running = undefined;
  });

  describe('preflight', () => {
    it('answers a preflight from an allowed site', async () => {
      running = await start();

      const res = await running.call('OPTIONS', '/escalated/widget/tickets', {
        headers: {
          Origin: SHOP,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(SHOP);
      expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
      expect(res.headers.get('access-control-allow-headers')).toBe(
        'Accept, Authorization, Content-Type, X-Requested-With',
      );
      expect(res.headers.get('access-control-max-age')).toBe('600');
      expect(res.headers.get('vary')).toContain('Origin');
      expect(res.headers.has('access-control-allow-credentials')).toBe(false);
    });

    it('answers preflights for nested widget and chat routes', async () => {
      running = await start();

      for (const path of [
        '/escalated/widget/tickets/12/replies',
        '/escalated/widget/chat/start',
        '/escalated/widget/chat/7/messages',
        '/escalated/widget/config',
      ]) {
        const res = await running.call('OPTIONS', path, {
          headers: { Origin: SHOP, 'Access-Control-Request-Method': 'POST' },
        });
        expect([path, res.status, res.headers.get('access-control-allow-origin')]).toEqual([
          path,
          204,
          SHOP,
        ]);
      }
    });

    it('gives no CORS grant to a site that is not allowed', async () => {
      running = await start();

      const preflight = await running.call('OPTIONS', '/escalated/widget/tickets', {
        headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' },
      });
      const config = await running.call('GET', '/escalated/widget/config', {
        headers: { Origin: EVIL },
      });

      expect(preflight.status).toBe(204);
      expect(preflight.headers.has('access-control-allow-origin')).toBe(false);
      expect(config.status).toBe(200);
      expect(config.headers.has('access-control-allow-origin')).toBe(false);
    });
  });

  describe('actual requests', () => {
    it('lets an allowed site create a ticket and read the answer', async () => {
      running = await start();

      const res = await running.call('POST', '/escalated/widget/tickets', {
        headers: { Origin: SHOP },
        body: ticketPayload,
      });

      expect(res.status).toBe(201);
      expect(res.headers.get('access-control-allow-origin')).toBe(SHOP);
      expect(res.headers.get('access-control-expose-headers')).toBe('Retry-After');
      expect(res.headers.get('vary')).toContain('Origin');
      expect(res.headers.has('access-control-allow-credentials')).toBe(false);
      expect(running.stubs.tickets.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a site that is not allowed', EVIL],
      ['the same site', 'same'],
      ['no Origin header', null],
    ])('handles %s exactly as before', async (_label, origin) => {
      running = await start();
      const headers: Record<string, string> =
        origin === null ? {} : { Origin: origin === 'same' ? running.base : origin };

      const res = await running.call('POST', '/escalated/widget/tickets', {
        headers,
        body: ticketPayload,
      });

      expect(res.status).toBe(201);
      expect(res.headers.has('access-control-allow-origin')).toBe(false);
    });

    it('reads allowed sites from the admin setting, including subdomain wildcards', async () => {
      running = await start({
        escalated: { widgetOrigins: [] },
        settings: { widget_allowed_origins: 'https://*.brand.test\nhttp://localhost:5173' },
      });
      const granted = async (origin: string) =>
        (
          await running!.call('GET', '/escalated/widget/config', { headers: { Origin: origin } })
        ).headers.get('access-control-allow-origin');

      expect(await granted('https://help.brand.test')).toBe('https://help.brand.test');
      expect(await granted('https://a.b.brand.test')).toBe('https://a.b.brand.test');
      expect(await granted('http://localhost:5173')).toBe('http://localhost:5173');
      expect(await granted('https://brand.test')).toBeNull();
      expect(await granted('http://help.brand.test')).toBeNull();
      expect(await granted('https://evilbrand.test')).toBeNull();
      expect(await granted('http://localhost:5174')).toBeNull();
    });

    it('reads allowed sites from ESCALATED_WIDGET_ALLOWED_ORIGINS', async () => {
      process.env.ESCALATED_WIDGET_ALLOWED_ORIGINS =
        'https://blog.example.com, https://docs.example.com';
      try {
        running = await start({ escalated: { widgetOrigins: [] } });

        const res = await running.call('GET', '/escalated/widget/config', {
          headers: { Origin: 'https://docs.example.com' },
        });

        expect(res.headers.get('access-control-allow-origin')).toBe('https://docs.example.com');
      } finally {
        delete process.env.ESCALATED_WIDGET_ALLOWED_ORIGINS;
      }
    });

    it('treats an embedded visitor as a guest even when signed in', async () => {
      running = await start({ signedInUser: { id: 7 } });
      const withoutEmail = { subject: 'Help', description: 'Please' };

      const sameSite = await running.call('POST', '/escalated/widget/tickets', {
        body: withoutEmail,
      });
      const embedded = await running.call('POST', '/escalated/widget/tickets', {
        headers: { Origin: SHOP },
        body: withoutEmail,
      });

      expect(sameSite.status).toBe(201);
      expect(running.stubs.tickets.create).toHaveBeenCalledTimes(1);
      expect(running.stubs.tickets.create).toHaveBeenLastCalledWith(expect.anything(), 7);
      expect(embedded.status).toBe(400);
      expect(embedded.headers.get('access-control-allow-origin')).toBe(SHOP);
      expect(running.stubs.tickets.create).toHaveBeenCalledTimes(1);
    });

    it('still accepts guest tokens from an allowed site', async () => {
      running = await start();

      const res = await running.call('GET', '/escalated/widget/tickets/1', {
        headers: { Origin: SHOP },
      });

      // No token: the guest guard answers, and the embed can read why.
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBe(SHOP);
    });

    it('adds CORS headers to error answers for allowed sites', async () => {
      running = await start();

      const notFound = await running.call('GET', '/escalated/widget/kb/articles/missing', {
        headers: { Origin: SHOP },
      });
      const invalid = await running.call('POST', '/escalated/widget/tickets', {
        headers: { Origin: SHOP },
        body: { subject: 'x', description: 'y' },
      });

      expect(notFound.status).toBe(404);
      expect(notFound.headers.get('access-control-allow-origin')).toBe(SHOP);
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get('access-control-allow-origin')).toBe(SHOP);
    });

    it('adds CORS headers to rate-limit answers for allowed sites', async () => {
      running = await start({ escalated: { guestRateLimit: { ticketsPerMinute: 1 } } });
      const submit = () =>
        running!.call('POST', '/escalated/widget/tickets', {
          headers: { Origin: SHOP },
          body: ticketPayload,
        });

      expect((await submit()).status).toBe(201);
      const limited = await submit();

      expect(limited.status).toBe(429);
      expect(limited.headers.get('access-control-allow-origin')).toBe(SHOP);
      expect(limited.headers.get('access-control-expose-headers')).toContain('Retry-After');
      expect(limited.headers.get('retry-after')).not.toBeNull();
    });
  });

  describe('GET /escalated/widget/config', () => {
    it('describes the widget and says it accepts host parameters', async () => {
      running = await start({ settings: { widget_color: '#112233' } });

      const res = await running.call('GET', '/escalated/widget/config');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        enabled: true,
        color: '#112233',
        position: 'bottom-right',
        greeting: 'Hi there! How can we help?',
        departments: [{ id: 1, name: 'Sales' }],
        kb_enabled: true,
        guest_tickets_enabled: true,
        accepts_metadata: true,
        guest_verification_required: true,
        status_lookup_enabled: true,
      });
    });

    it('reports the knowledge base as off when the module disables it', async () => {
      running = await start({ escalated: { enableKnowledgeBase: false } });

      const res = await running.call('GET', '/escalated/widget/config');

      expect((await res.json()).kb_enabled).toBe(false);
    });
  });

  describe('host parameters', () => {
    it('stores sanitised metadata sent with a widget ticket', async () => {
      running = await start();

      const res = await running.call('POST', '/escalated/widget/tickets', {
        headers: { Origin: SHOP },
        body: {
          ...ticketPayload,
          metadata: {
            order_number: 'A-1001',
            plan: ' pro ',
            items: 3,
            vip: true,
            page_url: 'https://shop.example.com/orders/A-1001',
            embedded_on: 'https://spoofed.example',
            nested: { not: 'kept' },
            list: [1, 2],
            empty: null,
            'bad key!': 'dropped',
            note: 'a'.repeat(600),
          },
        },
      });

      expect(res.status).toBe(201);
      const metadata = running.stubs.tickets.create.mock.calls[0][0].metadata;
      expect(metadata).toEqual({
        order_number: 'A-1001',
        plan: 'pro',
        items: 3,
        vip: true,
        page_url: 'https://shop.example.com/orders/A-1001',
        note: 'a'.repeat(500),
        embedded_on: SHOP,
      });
    });

    it('drops a page_url that is not a web address', async () => {
      running = await start();

      await running.call('POST', '/escalated/widget/tickets', {
        headers: { Origin: SHOP },
        body: { ...ticketPayload, metadata: { page_url: 'javascript:alert(1)', plan: 'pro' } },
      });

      expect(running.stubs.tickets.create.mock.calls[0][0].metadata).toEqual({
        plan: 'pro',
        embedded_on: SHOP,
      });
    });

    it('leaves tickets without host parameters unchanged', async () => {
      running = await start();

      await running.call('POST', '/escalated/widget/tickets', { body: ticketPayload });

      expect(running.stubs.tickets.create.mock.calls[0][0].metadata).toBeNull();
    });

    it.each([
      ['a list', [1, 2]],
      ['a string', 'order=1'],
      ['more than 50 keys', Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]))],
    ])('rejects metadata that is %s', async (_label, metadata) => {
      running = await start();

      const res = await running.call('POST', '/escalated/widget/tickets', {
        headers: { Origin: SHOP },
        body: { ...ticketPayload, metadata },
      });

      expect(res.status).toBe(400);
      expect(res.headers.get('access-control-allow-origin')).toBe(SHOP);
      expect(running.stubs.tickets.create).not.toHaveBeenCalled();
    });

    it('lets an allowed site start a live chat and keeps its host parameters', async () => {
      running = await start();

      const res = await running.call('POST', '/escalated/widget/chat/start', {
        headers: { Origin: SHOP },
        body: {
          name: 'John Doe',
          email: 'john@example.com',
          message: 'Hello',
          metadata: {
            page_url: 'https://shop.example.com/cart',
            cart_total: 129.5,
            deep: { x: 1 },
          },
        },
      });

      expect(res.status).toBe(201);
      expect(res.headers.get('access-control-allow-origin')).toBe(SHOP);
      expect(running.stubs.chat.start).toHaveBeenCalledWith(
        'John Doe',
        'john@example.com',
        'Hello',
        undefined,
        { page_url: 'https://shop.example.com/cart', cart_total: 129.5, embedded_on: SHOP },
      );
    });
  });

  describe('GET /escalated/widget/embed.js', () => {
    it('serves the standalone widget script for other sites to load', async () => {
      running = await start();

      const res = await running.call('GET', '/escalated/widget/embed.js', {
        headers: { Origin: EVIL },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(await res.text()).toBe(readFileSync(BUNDLE, 'utf8'));

      const etag = res.headers.get('etag');
      expect(etag).toMatch(/^"[0-9a-f]+"$/);
      const cached = await running.call('GET', '/escalated/widget/embed.js', {
        headers: { 'If-None-Match': etag! },
      });
      expect(cached.status).toBe(304);
      expect(cached.headers.get('etag')).toBe(etag);
    });
  });

  describe('admin settings', () => {
    const admin: CanActivate = { canActivate: () => true };

    it('saves and returns the sites that can embed the widget', async () => {
      running = await start({ escalated: { adminGuard: admin } });

      const saved = await running.call('PUT', '/escalated/admin/settings', {
        body: [
          {
            key: 'widget_allowed_origins',
            value: 'https://shop.example.com\nhttps://*.brand.test',
          },
        ],
      });
      const listed = await running.call('GET', '/escalated/admin/settings');

      expect(saved.status).toBe(200);
      expect(await listed.json()).toEqual([
        expect.objectContaining({
          key: 'widget_allowed_origins',
          value: 'https://shop.example.com\nhttps://*.brand.test',
        }),
      ]);
    });

    it('rejects entries that are not bare origins', async () => {
      running = await start({
        escalated: { adminGuard: admin },
        settings: { widget_allowed_origins: 'https://shop.example.com' },
      });

      const res = await running.call('PUT', '/escalated/admin/settings', {
        body: [
          { key: 'widget_color', value: '#000000' },
          { key: 'widget_allowed_origins', value: 'https://shop.example.com/checkout\n*' },
        ],
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain('https://shop.example.com/checkout');
      expect(running.stubs.settings.rows.get('widget_allowed_origins')!.value).toBe(
        'https://shop.example.com',
      );
      expect(running.stubs.settings.rows.has('widget_color')).toBe(false);
    });
  });
});
