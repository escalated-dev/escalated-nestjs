import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AgentProfile,
  EscalatedPlugin,
  Permission,
  PluginStoreRecord,
  Role,
} from '../../src/entities';
import type { EscalatedPluginDefinition } from '../../src/plugins/plugin-definition';
import {
  ADMIN,
  apiFetch,
  bootUi,
  cookieFrom,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * Plugins over real HTTP and SQLite, as domain-model/plugin-contract.md in
 * escalated-developer-context specifies them: the Admin/Plugins/Index screen
 * and its lifecycle routes, plugin pages rendered as Plugin/Page, and plugin
 * endpoints and webhooks. The plugins are `definePlugin()`-shaped objects
 * registered in the module options, run in this process.
 */
describe('plugins (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;

  const CRM = 'acme--escalated-plugin-crm';
  const asAdmin = { as: 'admin' as const };
  const calls: string[] = [];
  const seen: Record<string, any> = {};

  const crm: EscalatedPluginDefinition = {
    name: '@acme/escalated-plugin-crm',
    version: '1.2.0',
    description: 'Keeps contacts in step with the CRM.',
    author: 'Acme',
    homepage: 'https://acme.test/crm',
    pages: [
      {
        route: '/settings',
        component: 'CrmSettings',
        menu: { label: 'CRM', section: 'admin', position: 40 },
      },
      { route: 'reports/overview', component: 'CrmOverview', capability: 'manage_crm' },
      { route: '', component: 'Broken' },
    ],
    components: [{ page: 'ticket.show', slot: 'sidebar', component: 'CrmCard' }],
    widgets: [{ component: 'CrmWidget', label: 'CRM', size: 'half' }],
    endpoints: {
      'GET /CrmSettings': async (ctx) => ({
        api_key: (await ctx.config.get('api_key')) ? 'set' : 'unset',
      }),
      'POST /settings': async (ctx, req) => {
        await ctx.config.set(req.body as Record<string, unknown>);
        return ctx.config.all();
      },
      'GET /contacts/:id': async (_ctx, req) => {
        seen.request = req;
        return { id: req.params.id, query: req.query };
      },
      'DELETE /records': { capability: 'manage_crm', handler: async () => ({ deleted: true }) },
      'GET /boom': async () => {
        throw new Error('database password is hunter2');
      },
      'GET /teapot': async () => ({
        __escalated_http: 1,
        status: 418,
        headers: { 'x-plugin': 'crm' },
        format: 'text',
        body: 'short and stout',
      }),
      'GET /bad-envelope': async () => ({
        __escalated_http: 1,
        status: 200,
        headers: { 'set-cookie': 'a=b' },
        format: 'json',
        body: {},
      }),
    },
    webhooks: {
      'POST /inbound': async (_ctx, req) => {
        seen.webhook = req;
        return { received: req.body };
      },
    },
    onActivate: async (ctx) => {
      calls.push('crm.onActivate');
      await ctx.store.set('lifecycle', 'activated', { ok: true });
    },
    onDeactivate: async () => {
      calls.push('crm.onDeactivate');
    },
    actions: {
      'plugin.activated': async (event: any) => {
        calls.push(`crm saw plugin.activated ${event.slug}`);
      },
      'plugin.deactivated': async (event: any) => {
        calls.push(`crm saw plugin.deactivated ${event.slug}`);
      },
      'plugin.uninstalling': async (event: any) => {
        calls.push(`crm saw plugin.uninstalling ${event.slug}`);
      },
    },
  };

  const fragile: EscalatedPluginDefinition = {
    name: 'fragile',
    version: '0.1.0',
    onActivate: async () => {
      throw new Error('cannot reach the vendor');
    },
    onDeactivate: async () => {
      throw new Error('still cannot reach the vendor');
    },
  };

  /** A form the Inertia client submits from the plugins screen. */
  const submit = (path: string, method = 'POST') =>
    inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body: {},
      headers: { referer: `${base}/escalated/admin/plugins` },
    });

  /** The page a redirect lands on, with the flash data it carried. */
  const follow = (res: Response) =>
    page(base, res.headers.get('location')!, { ...asAdmin, headers: { cookie: cookieFrom(res) } });

  const row = (slug: string) => source.getRepository(EscalatedPlugin).findOne({ where: { slug } });

  const listed = async (slug: string) => {
    const index = await page(base, '/escalated/admin/plugins', asAdmin);
    return index.props.plugins.find((plugin: any) => plugin.slug === slug);
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({ plugins: [crm, fragile] }));
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  // Plugin capabilities apply while roles & permissions is switched on (ADR
  // 2026-10-29). The env switch is read per request; plugin pages and
  // endpoints map to no route permission, so only the capability decides.
  const rolesOn = () => {
    process.env.ESCALATED_ROLES_PERMISSIONS = 'true';
  };
  afterEach(() => {
    delete process.env.ESCALATED_ROLES_PERMISSIONS;
  });

  describe('Escalated/Admin/Plugins/Index', () => {
    it('lists every registered plugin, inactive until activated, without upload', async () => {
      const index = await page(base, '/escalated/admin/plugins', asAdmin);

      expect(index.component).toBe('Escalated/Admin/Plugins/Index');
      expectManifestProps(index);
      expect(index.props.can_upload).toBe(false);
      expect(index.props.plugins).toEqual([
        {
          slug: CRM,
          name: '@acme/escalated-plugin-crm',
          description: 'Keeps contacts in step with the CRM.',
          version: '1.2.0',
          author: 'Acme',
          author_url: 'https://acme.test/crm',
          homepage: 'https://acme.test/crm',
          is_active: false,
          activated_at: null,
          source: 'registered',
          provides: { menu_items: 1, widgets: 1, page_components: 1 },
        },
        expect.objectContaining({ slug: 'fragile', name: 'fragile', is_active: false }),
      ]);
    });

    it('is for admins only', async () => {
      for (const as of ['agent', 'customer'] as const) {
        expect((await inertiaFetch(base, '/escalated/admin/plugins', { as })).status).toBe(403);
        expect(
          (
            await inertiaFetch(base, `/escalated/admin/plugins/${CRM}/activate`, {
              as,
              method: 'POST',
              body: {},
            })
          ).status,
        ).toBe(403);
      }
      expect(await row(CRM)).toBeNull();
    });

    it('has no upload route, because plugins are registered in code', async () => {
      const res = await inertiaFetch(base, '/escalated/admin/plugins/upload', {
        ...asAdmin,
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(404);
    });
  });

  describe('lifecycle', () => {
    it('activates: the row, then onActivate, then plugin.activated, and back to the list', async () => {
      const res = await submit(`/escalated/admin/plugins/${CRM}/activate`);

      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/plugins');
      expect((await follow(res)).props.flash.success).toBe('Plugin activated.');

      const stored = await row(CRM);
      expect(stored).toMatchObject({ isActive: true, deactivatedAt: null });
      expect(stored!.activatedAt).toBeInstanceOf(Date);
      expect(calls).toEqual(['crm.onActivate', `crm saw plugin.activated ${CRM}`]);

      // onActivate wrote through ctx.store, keyed by the plugin's name.
      const records = await source
        .getRepository(PluginStoreRecord)
        .find({ where: { plugin: '@acme/escalated-plugin-crm', collection: 'lifecycle' } });
      expect(records.map((record) => [record.key, record.data])).toEqual([
        ['activated', { ok: true }],
      ]);

      expect(await listed(CRM)).toMatchObject({
        is_active: true,
        activated_at: expect.any(String),
      });
    });

    it('activating an active plugin succeeds and does nothing', async () => {
      const before = await row(CRM);
      const res = await submit(`/escalated/admin/plugins/${CRM}/activate`);

      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.success).toBe('Plugin activated.');
      expect(calls).toEqual([]);
      expect((await row(CRM))!.activatedAt).toEqual(before!.activatedAt);
    });

    it('a plugin whose onActivate throws is still activated, and the request succeeds', async () => {
      const res = await submit('/escalated/admin/plugins/fragile/activate');

      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.success).toBe('Plugin activated.');
      expect((await row('fragile'))!.isActive).toBe(true);
      // The other active plugin heard about it.
      expect(calls).toEqual(['crm saw plugin.activated fragile']);
    });

    it('an unknown slug is an error flash on a screen and a 404 for JSON, and creates nothing', async () => {
      const res = await submit('/escalated/admin/plugins/nope/activate');
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.error).toBe('Plugin not found.');

      const json = await apiFetch(base, '/escalated/admin/plugins/nope/activate', {
        ...asAdmin,
        method: 'POST',
        body: {},
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(json.status).toBe(404);
      expect(await row('nope')).toBeNull();
    });

    it('deactivates: plugin.deactivated while still active, then onDeactivate, then the row', async () => {
      const res = await submit('/escalated/admin/plugins/fragile/deactivate');
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.success).toBe('Plugin deactivated.');
      expect((await row('fragile'))!.isActive).toBe(false);

      calls.length = 0;
      await submit(`/escalated/admin/plugins/${CRM}/deactivate`);
      expect(calls).toEqual([`crm saw plugin.deactivated ${CRM}`, 'crm.onDeactivate']);
      const stored = await row(CRM);
      expect(stored!.isActive).toBe(false);
      expect(stored!.deactivatedAt).toBeInstanceOf(Date);

      calls.length = 0;
      const again = await submit(`/escalated/admin/plugins/${CRM}/deactivate`);
      expect((await follow(again)).props.flash.success).toBe('Plugin deactivated.');
      expect(calls).toEqual([]);
    });

    it('uninstalls a registered plugin: the row goes, the plugin stays listed, its data stays', async () => {
      await submit(`/escalated/admin/plugins/${CRM}/activate`);
      calls.length = 0;

      const res = await submit(`/escalated/admin/plugins/${CRM}`, 'DELETE');

      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.success).toBe('Plugin uninstalled.');
      expect(calls).toEqual([
        `crm saw plugin.uninstalling ${CRM}`,
        `crm saw plugin.deactivated ${CRM}`,
        'crm.onDeactivate',
      ]);
      expect(await row(CRM)).toBeNull();
      expect(await listed(CRM)).toMatchObject({ is_active: false, activated_at: null });
      expect(
        await source
          .getRepository(PluginStoreRecord)
          .count({ where: { plugin: '@acme/escalated-plugin-crm' } }),
      ).toBeGreaterThan(0);
    });
  });

  describe('Escalated/Plugin/Page', () => {
    beforeAll(async () => {
      await submit(`/escalated/admin/plugins/${CRM}/activate`);
    });

    it("renders an active plugin's page with the props of its GET /{component} endpoint", async () => {
      const shown = await page(base, `/escalated/admin/plugins/${CRM}/settings`, asAdmin);

      expect(shown.component).toBe('Escalated/Plugin/Page');
      expectManifestProps(shown);
      expect(shown.props).toMatchObject({
        plugin: '@acme/escalated-plugin-crm',
        component: 'CrmSettings',
        layout: 'admin',
        props: { api_key: 'unset' },
      });
    });

    it('renders a page with no props endpoint with empty props, behind its capability', async () => {
      const role = await source.getRepository(Role).save({ name: 'Manager', slug: 'manager' });
      await source.getRepository(AgentProfile).save({ userId: ADMIN, roleId: role.id });
      const path = `/escalated/admin/plugins/${CRM}/reports/overview`;

      // While roles & permissions is off the admin guard decides alone...
      expect((await inertiaFetch(base, path, asAdmin)).status).toBe(200);

      // ...and while it is on, an admin whose role lacks the capability is refused...
      rolesOn();
      expect((await inertiaFetch(base, path, asAdmin)).status).toBe(403);

      // ...until the role has it.
      const permission = await source
        .getRepository(Permission)
        .save({ slug: 'manage_crm', name: 'Manage CRM' });
      role.permissions = [permission];
      await source.getRepository(Role).save(role);

      const shown = await page(base, path, asAdmin);
      expect(shown.props).toMatchObject({ component: 'CrmOverview', props: {} });
    });

    it('is a 404 for an unknown page, a page with no route, and an unknown plugin', async () => {
      for (const path of [
        `/escalated/admin/plugins/${CRM}/nowhere`,
        `/escalated/admin/plugins/${CRM}/`,
        '/escalated/admin/plugins/nope/settings',
      ]) {
        expect((await inertiaFetch(base, path, asAdmin)).status).toBe(404);
      }
    });

    it('is for admins only, and gone while the plugin is inactive', async () => {
      const path = `/escalated/admin/plugins/${CRM}/settings`;
      expect((await inertiaFetch(base, path, { as: 'agent' })).status).toBe(403);

      await submit(`/escalated/admin/plugins/${CRM}/deactivate`);
      expect((await inertiaFetch(base, path, asAdmin)).status).toBe(404);
      await submit(`/escalated/admin/plugins/${CRM}/activate`);
    });
  });

  describe('endpoints and webhooks', () => {
    const api = `/escalated/api/plugins/${CRM}`;

    it('dispatches on the manifest path with params, query and body, and withholds credentials', async () => {
      const res = await apiFetch(base, `${api}/contacts/42?expand=deals`, {
        ...asAdmin,
        headers: { cookie: 'session=abc', authorization: 'Bearer secret', 'x-trace': 't1' },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: '42', query: { expand: 'deals' } });
      expect(seen.request.httpContract).toBe(1);
      expect(seen.request.params).toEqual({ id: '42' });
      expect(seen.request.headers['x-trace']).toBe('t1');
      expect(seen.request.headers).not.toHaveProperty('cookie');
      expect(seen.request.headers).not.toHaveProperty('authorization');
    });

    it('runs ctx.config through an endpoint, merging what it sets', async () => {
      const post = (body: unknown) =>
        apiFetch(base, `${api}/settings`, {
          ...asAdmin,
          body,
          headers: { 'x-requested-with': 'XMLHttpRequest' },
        });

      await post({ api_key: 'k1', region: 'eu' });
      const res = await post({ region: 'us' });
      expect(await res.json()).toEqual({ api_key: 'k1', region: 'us' });

      const shown = await page(base, `/escalated/admin/plugins/${CRM}/settings`, asAdmin);
      expect(shown.props.props).toEqual({ api_key: 'set' });
    });

    it('refuses a state-changing endpoint call that a page script did not send', async () => {
      const res = await apiFetch(base, `${api}/settings`, { ...asAdmin, body: { api_key: 'x' } });
      expect(res.status).toBe(403);
    });

    it('is for admins, behind any declared capability', async () => {
      expect((await apiFetch(base, `${api}/contacts/1`, { as: 'agent' })).status).toBe(403);

      await source.getRepository(Role).update({ slug: 'manager' }, { name: 'Manager' });
      const manager = await source
        .getRepository(Role)
        .findOneOrFail({ where: { slug: 'manager' } });
      manager.permissions = [];
      await source.getRepository(Role).save(manager);
      const del = () =>
        apiFetch(base, `${api}/records`, {
          ...asAdmin,
          method: 'DELETE',
          headers: { 'x-requested-with': 'XMLHttpRequest' },
        });
      // Roles & permissions off: the admin guard decides alone.
      expect((await del()).status).toBe(200);

      rolesOn();
      expect((await del()).status).toBe(403);

      // The role must hold the capability; its slug grants nothing.
      await source.getRepository(AgentProfile).delete({ userId: ADMIN });
      const crm = await source.getRepository(Permission).findOneByOrFail({ slug: 'manage_crm' });
      const admin = await source
        .getRepository(Role)
        .save({ name: 'Admin', slug: 'admin', permissions: [] });
      await source.getRepository(AgentProfile).save({ userId: ADMIN, roleId: admin.id });
      expect((await del()).status).toBe(403);
      admin.permissions = [crm];
      await source.getRepository(Role).save(admin);
      expect((await del()).status).toBe(200);
    });

    it('renders an httpResponse envelope, and refuses a malformed one', async () => {
      const res = await apiFetch(base, `${api}/teapot`, asAdmin);
      expect(res.status).toBe(418);
      expect(res.headers.get('x-plugin')).toBe('crm');
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(await res.text()).toBe('short and stout');

      const bad = await apiFetch(base, `${api}/bad-envelope`, asAdmin);
      expect(bad.status).toBe(502);
      expect(bad.headers.get('set-cookie')).toBeNull();
    });

    it('answers a throwing handler with a 500 that does not leak the error', async () => {
      const res = await apiFetch(base, `${api}/boom`, asAdmin);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain('hunter2');
    });

    it('is a 404 for an undeclared path or method and an unknown plugin', async () => {
      expect((await apiFetch(base, `${api}/nowhere`, asAdmin)).status).toBe(404);
      expect(
        (
          await apiFetch(base, `${api}/contacts/1`, {
            ...asAdmin,
            method: 'PATCH',
            body: {},
            headers: { 'x-requested-with': 'XMLHttpRequest' },
          })
        ).status,
      ).toBe(404);
      expect((await apiFetch(base, '/escalated/api/plugins/nope/contacts/1', asAdmin)).status).toBe(
        404,
      );
    });

    it('serves webhooks without auth, and not while the plugin is inactive', async () => {
      const hook = `/escalated/webhooks/plugins/${CRM}/inbound`;
      const send = () =>
        fetch(`${base}${hook}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-slack-signature': 'v0=abc' },
          body: JSON.stringify({ text: 'hello' }),
        });

      const res = await send();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: { text: 'hello' } });
      expect(seen.webhook.headers['x-slack-signature']).toBe('v0=abc');

      await submit(`/escalated/admin/plugins/${CRM}/deactivate`);
      expect((await send()).status).toBe(404);
      expect((await apiFetch(base, `${api}/contacts/1`, asAdmin)).status).toBe(404);
      await submit(`/escalated/admin/plugins/${CRM}/activate`);
    });
  });
});
