import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { embedAdmin } from '../../src';
import { seedRolesAndPermissions } from '../../src/access/permission-seed';
import { AgentProfile, Permission, Role } from '../../src/entities';
import type { EscalatedPluginDefinition } from '../../src/plugins/plugin-definition';
import { HostAdminMiddleware, hostDenyGuard } from '../fixtures/embed/host';
import { routeTableOf, type RouteTable } from './route-table';
import { apiFetch, bootUi, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * The admin embedded in a host admin panel, layout mode (ADR
 * 2026-11-05-embeddable-admin), over real HTTP and SQLite: routes under the
 * host's prefix with the host's middleware and guards and the same names,
 * Escalated's admin gate kept, the embed flag and the admin menu shared.
 */

const PREFIX = 'backoffice/helpdesk';
const DEFAULT: Record<string, RouteTable> = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'embed', 'default-routes.json'), 'utf8'),
);

const crm: EscalatedPluginDefinition = {
  name: 'crm',
  version: '1.0.0',
  pages: [
    {
      route: 'settings',
      component: 'CrmSettings',
      menu: { label: 'CRM', section: 'admin', position: 61, icon: 'crm' },
    },
  ],
};

const asAdmin = { as: 'admin' as const };

describe('embedded admin, layout mode', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootUi(
      {
        plugins: [crm],
        ui: {
          embed: embedAdmin({
            prefix: PREFIX,
            middleware: [HostAdminMiddleware],
            guards: [hostDenyGuard],
            layout: 'Layouts/AdminLayout',
          }),
        },
      },
      { imports: [DiscoveryModule] },
    ));
    const activate = await inertiaFetch(base, `/${PREFIX}/plugins/crm/activate`, {
      ...asAdmin,
      body: {},
      headers: { referer: `${base}/${PREFIX}/plugins` },
    });
    expect(activate.status).toBe(303);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('serves the admin under the host prefix, through the host middleware', async () => {
    const res = await inertiaFetch(base, `/${PREFIX}/tags`, asAdmin);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-host-admin')).toBe('1');
    const body = await res.json();
    expect(body.component).toBe('Escalated/Admin/Tags/Index');
    expect(body.props.ziggy.routes['escalated.admin.tags.index'].uri).toBe(`${PREFIX}/tags`);

    // The JSON admin API moves with the screens.
    const api = await apiFetch(base, `/${PREFIX}/agents`, asAdmin);
    expect(api.status).toBe(200);
    expect(api.headers.get('x-host-admin')).toBe('1');
  });

  it('no longer serves the standalone admin URLs', async () => {
    for (const path of ['/escalated/admin/tags', '/escalated/admin/plugins', '/escalated/admin']) {
      expect((await inertiaFetch(base, path, asAdmin)).status).toBe(404);
    }
    expect((await apiFetch(base, '/escalated/admin/agents', asAdmin)).status).toBe(404);
  });

  it('moves every admin route that lived under /escalated/admin, with the same guards and names', () => {
    const live = routeTableOf(app);
    const moved = (path: string) =>
      path.startsWith('/escalated/admin/settings/two-factor')
        ? path
        : path.replace(/^\/escalated\/admin(?=\/|$)/, `/${PREFIX}`);
    const expected = DEFAULT.screens.routes
      .map((route) => {
        if (
          !/^\/escalated\/admin(\/|$)/.test(route.path) ||
          route.controller === 'TwoFactorController'
        )
          return route;
        return {
          ...route,
          controller: `Embedded${route.controller}`,
          path: moved(route.path),
          guards: route.guards.map((g) => (g === 'EscalatedAdminGuard' ? 'EmbeddedAdminGuard' : g)),
        };
      })
      .sort(
        (a, b) =>
          a.path.localeCompare(b.path) ||
          a.method.localeCompare(b.method) ||
          a.controller.localeCompare(b.controller),
      );
    // The screens fixture also has the newsletter routes, which this app does not enable.
    const withoutNewsletters = expected.filter((r) => !/Newsletter/.test(r.controller));
    expect(live.routes).toEqual(withoutNewsletters);
    expect(live.routes.filter((r) => r.path.startsWith(`/${PREFIX}/`)).length).toBeGreaterThan(150);
    expect(
      live.routes.filter(
        (r) =>
          r.path.startsWith('/escalated/admin') &&
          !r.path.startsWith('/escalated/admin/settings/two-factor'),
      ),
    ).toEqual([]);

    // Same names; admin URLs follow, two-factor enrolment and the rest stay.
    const named = DEFAULT.screens.named;
    expect(Object.keys(live.named).sort()).toEqual(Object.keys(named).sort());
    for (const [name, route] of Object.entries(named)) {
      const admin =
        name.startsWith('escalated.admin.') &&
        !name.startsWith('escalated.admin.two-factor.') &&
        route.uri.startsWith('escalated/admin/');
      expect([name, live.named[name]]).toEqual([
        name,
        admin ? { ...route, uri: PREFIX + route.uri.slice('escalated/admin'.length) } : route,
      ]);
    }
    expect(live.named['escalated.agent.dashboard'].uri).toBe('escalated/agent');
    expect(live.named['escalated.admin.two-factor.index'].uri).toBe(
      'escalated/admin/settings/two-factor',
    );
  });

  it('runs the host guard and the host middleware, which can refuse', async () => {
    const denied = await inertiaFetch(base, `/${PREFIX}/tags`, {
      ...asAdmin,
      headers: { 'x-host-deny': '1' },
    });
    expect(denied.status).toBe(403);
    const blocked = await inertiaFetch(base, `/${PREFIX}/tags`, {
      ...asAdmin,
      headers: { 'x-host-block': '1' },
    });
    expect(blocked.status).toBe(401);
    expect(await blocked.text()).toBe('Sign in to the back office first.');
  });

  it("keeps Escalated's admin gate", async () => {
    expect((await inertiaFetch(base, `/${PREFIX}/tags`, { as: 'agent' })).status).toBe(403);
    expect((await inertiaFetch(base, `/${PREFIX}/tags`, { as: 'customer' })).status).toBe(403);
  });

  it('shares the embed flag on embedded pages', async () => {
    const body = await page(base, `/${PREFIX}/tags`, asAdmin);
    expect(body.props.escalated.embed).toEqual({
      enabled: true,
      mode: 'layout',
      layout: 'Layouts/AdminLayout',
      route: 'escalated.admin.tags.index',
      base_url: `/${PREFIX}`,
      allowed_origins: [],
    });
    const edit = await page(base, `/${PREFIX}/sla-policies/create`, asAdmin);
    expect(edit.props.escalated.embed.route).toBe('escalated.admin.sla-policies.create');
  });

  it('marks other pages as not embedded, still sharing the menu', async () => {
    const res = await inertiaFetch(base, '/escalated/agent', asAdmin);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-host-admin')).toBeNull();
    const body = await res.json();
    expect(body.props.escalated.embed.enabled).toBe(false);
    expect(body.props.escalated.embed.route).toBeNull();
    expect(body.props.escalated.navigation.length).toBeGreaterThan(10);
  });

  it('adds no framing headers in layout mode', async () => {
    const res = await inertiaFetch(base, `/${PREFIX}/tags`, asAdmin);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('shares the admin menu with the documented item shape, in order, with the active item', async () => {
    const items = (await page(base, `/${PREFIX}/tags`, asAdmin)).props.escalated.navigation;
    expect(items[0]).toEqual({
      key: 'reports',
      label: 'Reports',
      route: 'escalated.admin.reports',
      url: `/${PREFIX}/reports`,
      icon: 'reports',
      position: 10,
      active: false,
      badge: null,
      plugin: null,
      children: [],
    });
    expect(items[1].key).toBe('tickets');
    expect(items.filter((i: any) => i.active).map((i: any) => i.key)).toEqual(['tags']);
    const positions = items.map((i: any) => i.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(items[items.length - 1].key).toBe('settings');
    expect(items.find((i: any) => i.key === 'automations').position).toBe(53.5);
  });

  it('leaves out screens whose feature is off', async () => {
    const keys = (await page(base, `/${PREFIX}/tags`, asAdmin)).props.escalated.navigation.map(
      (i: any) => i.key,
    );
    expect(keys).not.toContain('roles');
    expect(keys).not.toContain('newsletters');
    expect(keys).toEqual(expect.arrayContaining(['tags', 'settings', 'api-tokens', 'plugins']));
  });

  it('gives no menu to a user who may not use the admin', async () => {
    const body = await page(base, '/escalated/agent', { as: 'agent' });
    expect(body.props.escalated.navigation).toEqual([]);
  });

  it('includes plugin admin menu items, under the moved plugin pages', async () => {
    const items = (await page(base, `/${PREFIX}/tags`, asAdmin)).props.escalated.navigation;
    const index = items.findIndex((i: any) => i.label === 'CRM');
    expect(items[index]).toEqual({
      key: 'plugin:crm:0',
      label: 'CRM',
      route: null,
      url: `/${PREFIX}/plugins/crm/settings`,
      icon: 'crm',
      position: 61,
      active: false,
      badge: null,
      plugin: 'crm',
      children: [],
    });
    expect(items[index - 1].key).toBe('tags');
    const plugin = await page(base, `/${PREFIX}/plugins/crm/settings`, asAdmin);
    expect(plugin.component).toBe('Escalated/Plugin/Page');
    expect(plugin.props.escalated.navigation.find((i: any) => i.active)?.label).toBe('CRM');
  });
});

describe('embedded admin navigation with roles & permissions', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      access: { rolesPermissions: true },
      ui: { embed: embedAdmin({ prefix: PREFIX }) },
    } as any));
    await seedRolesAndPermissions(source.manager);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function staffWith(id: number, slugs: string[] | 'admin') {
    const roles = source.getRepository(Role);
    const role =
      slugs === 'admin'
        ? await roles.findOneByOrFail({ slug: 'admin' })
        : await roles.save({
            name: `Custom ${id}`,
            slug: `custom-${id}`,
            permissions: await source
              .getRepository(Permission)
              .find({ where: slugs.map((slug) => ({ slug })) }),
          });
    await source.getRepository(AgentProfile).save({ userId: id, roleId: role.id } as any);
    return { 'x-role': 'agent,admin', 'x-user': String(id) };
  }

  it('drops the items whose route the user may not open', async () => {
    const headers = await staffWith(900, ['tag.view', 'ticket.view']);
    const body = await page(base, `/${PREFIX}/tags`, { headers });
    const keys = body.props.escalated.navigation.map((i: any) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['tags', 'tickets']));
    expect(keys).not.toContain('settings');
    expect(keys).not.toContain('users');
    expect(keys).not.toContain('roles');
    // And the route the menu left out answers 403.
    expect((await inertiaFetch(base, `/${PREFIX}/settings`, { headers })).status).toBe(403);
  });

  it('lists Roles while roles & permissions is on, for a user who may see it', async () => {
    const headers = await staffWith(901, 'admin');
    const keys = (await page(base, `/${PREFIX}/tags`, { headers })).props.escalated.navigation.map(
      (i: any) => i.key,
    );
    expect(keys).toEqual(expect.arrayContaining(['roles', 'settings', 'users']));
  });
});
