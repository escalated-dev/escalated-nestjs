import { seedRolesAndPermissions } from '../../src/access/permission-seed';
import { RoleService } from '../../src/services/role.service';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentProfile, ApiToken, Permission, Role } from '../../src/entities';
import { hashApiToken } from '../../src/services/api-token.service';
import {
  ADMIN,
  AGENT,
  apiFetch,
  bootUi,
  cookieFrom,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The people screens over real HTTP and SQLite: roles and API tokens, with
 * escalated-laravel's Admin\RoleController and ApiTokenController as the
 * contract. (`Admin/Users/Index` needs the host's user table, which this
 * package does not own.)
 */
describe('admin people screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let viewTickets: Permission;
  let manageUsers: Permission;
  let support: Role;

  const asAdmin = { as: 'admin' as const };

  const submit = (path: string, body: unknown, method = 'POST', from = path) =>
    inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body,
      headers: { referer: `${base}${from}` },
    });

  const follow = (res: Response) =>
    page(base, res.headers.get('location')!, {
      ...asAdmin,
      headers: { cookie: cookieFrom(res) },
    });

  beforeAll(async () => {
    // The roles screens exist only while roles & permissions is switched on,
    // which also makes the admin need a role (ADR 2026-10-29).
    ({ app, source, base } = await bootUi({
      access: { rolesPermissions: true },
      ui: {
        enabled: true,
        resolveUsers: (ids) =>
          ids.map((id) => ({ id, name: `Host user ${id}`, email: `u${id}@example.com` })),
      },
    }));
    const permissions = source.getRepository(Permission);
    viewTickets = await permissions.save({
      slug: 'tickets.view',
      name: 'View tickets',
      group: 'tickets',
    });
    manageUsers = await permissions.save({
      slug: 'admin.users',
      name: 'Manage users',
      group: 'admin',
    });
    support = await source.getRepository(Role).save({
      name: 'Support',
      slug: 'support',
      isSystem: true,
      permissions: [viewTickets],
    });
    await source
      .getRepository(AgentProfile)
      .save({ userId: AGENT, displayName: 'Agent', isActive: true, roleId: support.id });
    await seedRolesAndPermissions(source.manager);
    await app.get(RoleService).assignRole(ADMIN, 'admin');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the people screens behind the admin guard', async () => {
    for (const path of ['/escalated/admin/roles', '/escalated/admin/api-tokens']) {
      expect((await inertiaFetch(base, path, { as: 'agent' })).status).toBe(403);
    }
  });

  describe('Escalated/Admin/Roles', () => {
    it('lists roles with their agents and permissions', async () => {
      const result = await page(base, '/escalated/admin/roles', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Roles/Index');
      expectManifestProps(result);
      expect(result.props.roles).toContainEqual(
        expect.objectContaining({
          id: support.id,
          name: 'Support',
          is_system: true,
          users_count: 1,
          permissions: [expect.objectContaining({ id: viewTickets.id, slug: 'tickets.view' })],
        }),
      );
    });

    it('creates, edits and deletes a role with the permission matrix', async () => {
      const create = await page(base, '/escalated/admin/roles/create', asAdmin);
      expect(create.component).toBe('Escalated/Admin/Roles/Form');
      expectManifestProps(create);
      expect(create.props.role).toBeNull();
      // Beside the seeded groups (Tickets, Replies, ...), the two made here.
      expect(create.props.permissions.admin).toEqual([
        expect.objectContaining({ id: manageUsers.id, name: 'Manage users' }),
      ]);
      expect(create.props.permissions.tickets).toEqual([
        expect.objectContaining({ id: viewTickets.id, name: 'View tickets' }),
      ]);

      const res = await submit('/escalated/admin/roles', {
        name: 'Team Lead',
        description: 'Leads',
        permissions: [viewTickets.id, manageUsers.id],
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/roles');
      expect((await follow(res)).props.flash.success).toBe('Role created.');
      const role = await source
        .getRepository(Role)
        .findOneOrFail({ where: { slug: 'team-lead' }, relations: { permissions: true } });
      expect(role.permissions.map((p) => p.id).sort()).toEqual(
        [viewTickets.id, manageUsers.id].sort(),
      );

      const edit = await page(base, `/escalated/admin/roles/${role.id}/edit`, asAdmin);
      expect(edit.props.role).toMatchObject({ id: role.id, name: 'Team Lead' });
      expect(edit.props.role.permissions).toHaveLength(2);

      await submit(
        `/escalated/admin/roles/${role.id}`,
        { name: 'Lead', description: '', permissions: [] },
        'PUT',
      );
      const updated = await source
        .getRepository(Role)
        .findOneOrFail({ where: { id: role.id }, relations: { permissions: true } });
      expect(updated).toMatchObject({ name: 'Lead', slug: 'team-lead' });
      expect(updated.permissions).toEqual([]);

      await submit(`/escalated/admin/roles/${role.id}`, undefined, 'DELETE');
      expect(await source.getRepository(Role).countBy({ id: role.id })).toBe(0);
    });

    it('refuses to delete a system role, and a nameless role', async () => {
      const res = await submit(
        `/escalated/admin/roles/${support.id}`,
        undefined,
        'DELETE',
        '/escalated/admin/roles',
      );
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.error).toMatch(/system/i);
      expect(await source.getRepository(Role).countBy({ id: support.id })).toBe(1);

      const bad = await submit(
        '/escalated/admin/roles',
        { name: '' },
        'POST',
        '/escalated/admin/roles/create',
      );
      expect(Object.keys((await follow(bad)).props.errors)).toEqual(['name']);
    });

    it('keeps the JSON API for API clients', async () => {
      const res = await apiFetch(base, '/escalated/admin/roles', asAdmin);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    });
  });

  describe('Escalated/Admin/ApiTokens/Index', () => {
    it('creates a token, shows it once, lists it without the secret, and revokes it', async () => {
      const res = await submit('/escalated/admin/api-tokens', {
        name: 'CI',
        user_id: AGENT,
        abilities: ['agent'],
        expires_in_days: 30,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/api-tokens');
      const stored = await source.getRepository(ApiToken).findOneByOrFail({ name: 'CI' });
      expect(stored).toMatchObject({ userId: AGENT, abilities: ['agent'] });
      expect(new Date(stored.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

      const index = await follow(res);
      expect(index.component).toBe('Escalated/Admin/ApiTokens/Index');
      expectManifestProps(index);
      // The screen shows the plain token once; only its SHA-256 digest is stored.
      const shown = index.props.flash.plain_text_token;
      expect(shown).toMatch(/^[0-9a-f]{80}$/);
      expect(stored.token).toBe(hashApiToken(shown));
      expect(JSON.stringify(index)).not.toContain(stored.token);
      expect(index.props.api_enabled).toBe(true);
      // Agents: AGENT, and ADMIN, whose admin role lives on an agent profile.
      expect(index.props.users).toEqual([
        { id: ADMIN, name: `Host user ${ADMIN}`, email: `u${ADMIN}@example.com` },
        { id: AGENT, name: `Host user ${AGENT}`, email: `u${AGENT}@example.com` },
      ]);
      const listed = index.props.tokens.find((t: any) => t.id === stored.id);
      expect(listed).toMatchObject({
        name: 'CI',
        user_name: `Host user ${AGENT}`,
        user_email: `u${AGENT}@example.com`,
        abilities: ['agent'],
        is_expired: false,
        last_used_at: null,
      });
      expect(JSON.stringify(index.props.tokens)).not.toContain(stored.token);

      // The flash is shown once.
      const again = await page(base, '/escalated/admin/api-tokens', asAdmin);
      expect(again.props.flash.plain_text_token).toBeUndefined();

      const revoked = await submit(
        `/escalated/admin/api-tokens/${stored.id}`,
        undefined,
        'DELETE',
        '/escalated/admin/api-tokens',
      );
      expect(revoked.status).toBe(303);
      expect(await source.getRepository(ApiToken).countBy({ id: stored.id })).toBe(0);
    });

    it('refuses a token for someone who is not an agent, or with unknown abilities', async () => {
      const notAgent = await submit(
        '/escalated/admin/api-tokens',
        { name: 'X', user_id: 4242, abilities: ['agent'] },
        'POST',
        '/escalated/admin/api-tokens',
      );
      expect(Object.keys((await follow(notAgent)).props.errors)).toEqual(['user_id']);

      const ability = await submit(
        '/escalated/admin/api-tokens',
        { name: 'X', user_id: AGENT, abilities: ['root'] },
        'POST',
        '/escalated/admin/api-tokens',
      );
      expect(Object.keys((await follow(ability)).props.errors)).toEqual(['abilities']);
      expect(await source.getRepository(ApiToken).countBy({ name: 'X' })).toBe(0);
    });
  });

  it('names every route the people screens call', async () => {
    const result = await page(base, '/escalated/admin/roles', asAdmin);
    const routes = Object.keys(result.props.ziggy.routes);
    for (const action of ['index', 'create', 'store', 'edit', 'update', 'destroy']) {
      expect(routes).toContain(`escalated.admin.roles.${action}`);
    }
  });
});
