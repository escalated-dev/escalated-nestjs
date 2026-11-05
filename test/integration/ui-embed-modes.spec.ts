import { INestApplication } from '@nestjs/common';
import { embedAdmin } from '../../src';
import {
  BackOfficeController,
  hostAdminRootView,
  hostFramingMiddleware,
  hostOwnerGuard,
} from '../fixtures/embed/host';
import { bootUi, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * The other embedded-admin setups (ADR 2026-11-05-embeddable-admin): the
 * host's own gate replacing Escalated's, iframe mode with its framing
 * headers, and a server-rendered host's root view.
 */

const PREFIX = 'backoffice/helpdesk';
const asAdmin = { as: 'admin' as const };

describe('replaceAdminGate: the host gate alone decides', () => {
  let app: INestApplication;
  let base: string;
  const owner = { headers: { 'x-role': 'customer', 'x-user': '500', 'x-owner': 'yes' } };

  beforeAll(async () => {
    ({ app, base } = await bootUi({
      ui: {
        embed: embedAdmin({ prefix: PREFIX, guards: [hostOwnerGuard], replaceAdminGate: true }),
      },
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets a user the host gate admits in, with the menu', async () => {
    const body = await page(base, `/${PREFIX}/tags`, owner);
    expect(body.component).toBe('Escalated/Admin/Tags/Index');
    expect(body.props.escalated.embed.enabled).toBe(true);
    expect(body.props.escalated.navigation.length).toBeGreaterThan(10);
    // `is_admin` keeps using Escalated's gate.
    expect(body.props.escalated.is_admin).toBe(false);
  });

  it('refuses an Escalated admin the host gate refuses', async () => {
    expect((await inertiaFetch(base, `/${PREFIX}/tags`, asAdmin)).status).toBe(403);
  });

  it("keeps Escalated's gates on the agent panel", async () => {
    expect((await inertiaFetch(base, '/escalated/agent', owner)).status).toBe(403);
  });

  it('is refused at boot without any host guard or middleware', () => {
    expect(() => embedAdmin({ replaceAdminGate: true })).toThrow(/guards or middleware/);
  });
});

describe('iframe mode', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootUi(
      {
        ui: {
          embed: embedAdmin({
            prefix: PREFIX,
            mode: 'iframe',
            frameAncestors: [
              'https://admin.example.com',
              'https://*.evil.example',
              '*',
              'https://admin.example.com/',
            ],
          }),
        },
      },
      undefined,
      // The host's own headers on every response, set before Escalated's.
      (host) => host.use(hostFramingMiddleware),
    ));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets only the allow-listed origins frame an embedded page', async () => {
    for (const visit of [
      inertiaFetch,
      (b: string, p: string) =>
        fetch(`${b}${p}`, {
          headers: { 'x-role': 'agent,admin', 'x-user': '1', accept: 'text/html' },
        }),
    ]) {
      const res = await visit(base, `/${PREFIX}/tags`, asAdmin);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-security-policy')).toBe(
        "frame-ancestors 'self' https://admin.example.com",
      );
      expect(res.headers.get('x-frame-options')).toBeNull();
    }
  });

  it("leaves every other response's framing headers alone", async () => {
    const res = await inertiaFetch(base, '/escalated/agent', asAdmin);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    // A refused embedded request is not framed either.
    const refused = await inertiaFetch(base, `/${PREFIX}/tags`, { as: 'agent' });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('shares the allow-list, without wildcards, for the postMessage bridge', async () => {
    const body = await page(base, `/${PREFIX}/tags`, asAdmin);
    expect(body.props.escalated.embed).toMatchObject({
      enabled: true,
      mode: 'iframe',
      allowed_origins: ['https://admin.example.com'],
    });
  });

  it("keeps the host's own policy and adds frame-ancestors as a second one", async () => {
    const res = await inertiaFetch(base, `/${PREFIX}/tags`, {
      ...asAdmin,
      headers: { 'x-host-csp': '1' },
    });
    // Two Content-Security-Policy headers, which fetch joins with ", ".
    expect(res.headers.get('content-security-policy')).toBe(
      "script-src 'self', frame-ancestors 'self' https://admin.example.com",
    );
  });
});

describe('a server-rendered host: the root view', () => {
  let app: INestApplication;
  let base: string;
  const html = (path: string, role = 'agent,admin') =>
    fetch(`${base}${path}`, { headers: { 'x-role': role, 'x-user': '1', accept: 'text/html' } });

  beforeAll(async () => {
    ({ app, base } = await bootUi(
      { ui: { embed: embedAdmin({ prefix: PREFIX, rootView: hostAdminRootView }) } },
      { controllers: [BackOfficeController] },
    ));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("renders embedded pages in the host's template, with Escalated's menu", async () => {
    const res = await html(`/${PREFIX}/tags`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('data-host-admin-sidebar');
    expect(text).toContain(`<a href="/${PREFIX}/tags" class="active" aria-current="page">Tags</a>`);
    expect(text).toContain(`<a href="/${PREFIX}/reports">Reports</a>`);
    expect(text).toContain('Escalated/Admin/Tags/Index');
  });

  it('keeps the normal root view everywhere else', async () => {
    const res = await html('/escalated/agent');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('data-host-admin-sidebar');
    expect(text).toContain('Escalated/Agent');
  });

  it("gives the host's own pages the same menu through EscalatedAdminNavigation", async () => {
    const admin = await (
      await fetch(`${base}/admin`, { headers: { 'x-user': '1', 'x-admin': 'yes' } })
    ).json();
    expect(admin.support[0]).toMatchObject({ key: 'reports', url: `/${PREFIX}/reports` });
    expect(admin.support.length).toBeGreaterThan(10);
    const other = await (await fetch(`${base}/admin`, { headers: { 'x-user': '2' } })).json();
    expect(other.support).toEqual([]);
  });

  it('adds no framing headers in layout mode', async () => {
    const res = await html(`/${PREFIX}/tags`);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('with no embed configuration', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootUi({}, undefined, (host) => host.use(hostFramingMiddleware)));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the standalone admin with no embed or navigation props and no framing changes', async () => {
    const res = await inertiaFetch(base, '/escalated/admin/tags', asAdmin);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('content-security-policy')).toBeNull();
    const body = await res.json();
    expect(body.props.escalated).not.toHaveProperty('embed');
    expect(body.props.escalated).not.toHaveProperty('navigation');
    expect(body.props.ziggy.routes['escalated.admin.tags.index'].uri).toBe('escalated/admin/tags');
    expect((await inertiaFetch(base, `/${PREFIX}/tags`, asAdmin)).status).toBe(404);
  });
});
