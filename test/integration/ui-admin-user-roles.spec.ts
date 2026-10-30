import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EscalatedUiHostUser } from '../../src';
import { AgentProfile, Permission, Role } from '../../src/entities';
import { seedRolesAndPermissions } from '../../src/access/permission-seed';
import { AccessControlService } from '../../src/access/access-control.service';
import { bootUi, cookieFrom, expectManifestProps, inertiaFetch, page } from './ui-harness';

jest.setTimeout(120000);

/**
 * The users screen's roles picker (`PUT escalated.admin.users.roles` with
 * `{role_ids: [...]}`), with escalated-laravel's Admin\UserController::updateRoles
 * as the contract: only while roles & permissions is on, needs `role.manage`,
 * validates the ids, keeps you from removing your own role management and
 * redirects back with "User updated.". An agent here has one role (the role
 * on their agent profile), so the set maps to one role.
 */

const ROLE_MANAGER = 9001;
const AGENT = 9002;
const PLAIN = 9003;
const UNKNOWN = 9999;

const people: EscalatedUiHostUser[] = [
  { id: ROLE_MANAGER, name: 'Rita Roles', email: 'rita@example.com', isAdmin: true, isAgent: true },
  { id: AGENT, name: 'Alan Agent', email: 'alan@example.com', isAgent: true },
  { id: PLAIN, name: 'Pat Plain', email: 'pat@example.com' },
];

const ui = {
  enabled: true,
  listUsers: () => ({ data: people, total: people.length }),
  resolveUsers: (ids: string[]) => people.filter((u) => ids.includes(String(u.id))),
};

const as = (id: number, kind: 'admin' | 'agent' = 'admin') => ({
  headers: { 'x-role': kind === 'admin' ? 'agent,admin' : 'agent', 'x-user': String(id) },
});

async function boot(rolesPermissions: boolean) {
  const booted = await bootUi({ access: { rolesPermissions }, ui } as any);
  await seedRolesAndPermissions(booted.source.manager);
  return booted;
}

async function roleId(source: DataSource, slug: string): Promise<number> {
  return (await source.getRepository(Role).findOneByOrFail({ slug })).id;
}

async function giveRole(source: DataSource, userId: number, id: number | null) {
  const profiles = source.getRepository(AgentProfile);
  const profile = await profiles.findOne({ where: { userId } });
  if (profile) await profiles.update(profile.id, { roleId: id as any });
  else await profiles.save(profiles.create({ userId, roleId: id as any }));
}

async function profileRole(source: DataSource, userId: number): Promise<number | null> {
  return (await source.getRepository(AgentProfile).findOne({ where: { userId } }))?.roleId ?? null;
}

describe('users screen roles picker, roles & permissions off', () => {
  let app: INestApplication;
  let base: string;
  let source: DataSource;

  beforeAll(async () => {
    ({ app, base, source } = await boot(false));
  });
  afterAll(async () => {
    await app?.close();
  });

  it('is not there (404) and the screen sends no roles', async () => {
    const light = await roleId(source, 'light_agent');
    const res = await inertiaFetch(base, `/escalated/admin/users/${AGENT}/roles`, {
      ...as(ROLE_MANAGER),
      method: 'PUT',
      body: { role_ids: [light] },
    });
    expect(res.status).toBe(404);
    expect(await profileRole(source, AGENT)).toBeNull();

    const index = await page(base, '/escalated/admin/users', as(ROLE_MANAGER));
    expectManifestProps(index);
    expect(index.props.roles).toBeNull();
    expect(index.props.users.data[0]).not.toHaveProperty('roles');
  });
});

describe('users screen roles picker, roles & permissions on', () => {
  let app: INestApplication;
  let base: string;
  let source: DataSource;
  let admin: number;
  let agent: number;
  let light: number;

  const put = (target: number, body: unknown, actor = ROLE_MANAGER) =>
    inertiaFetch(base, `/escalated/admin/users/${target}/roles`, {
      ...as(actor),
      method: 'PUT',
      body,
      headers: { ...as(actor).headers, referer: `${base}/escalated/admin/users?page=1` },
    });

  const follow = (res: Response, actor = ROLE_MANAGER) =>
    page(base, res.headers.get('location')!, {
      headers: { ...as(actor).headers, cookie: cookieFrom(res) },
    });

  beforeAll(async () => {
    ({ app, base, source } = await boot(true));
    admin = await roleId(source, 'admin');
    agent = await roleId(source, 'agent');
    light = await roleId(source, 'light_agent');
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    await giveRole(source, ROLE_MANAGER, admin);
    await giveRole(source, AGENT, agent);
    await source.getRepository(AgentProfile).delete({ userId: PLAIN });
  });

  it('sends the roles and each user role slugs', async () => {
    const index = await page(base, '/escalated/admin/users', as(ROLE_MANAGER));
    expectManifestProps(index);
    const names = index.props.roles.map((r: any) => r.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    expect(index.props.roles).toEqual(
      expect.arrayContaining([{ id: light, name: expect.any(String), slug: 'light_agent' }]),
    );
    expect(Object.keys(index.props.roles[0]).sort()).toEqual(['id', 'name', 'slug']);
    const rows = Object.fromEntries(index.props.users.data.map((u: any) => [u.id, u.roles]));
    expect(rows).toEqual({ [ROLE_MANAGER]: ['admin'], [AGENT]: ['agent'], [PLAIN]: [] });
  });

  it("replaces a user's role and redirects back with Laravel's flash", async () => {
    const res = await put(AGENT, { role_ids: [light] });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/escalated/admin/users?page=1');
    const next = await follow(res);
    expect(next.props.flash.success).toBe('User updated.');
    expect(await profileRole(source, AGENT)).toBe(light);

    const permissions = await app.get(AccessControlService).userPermissions(AGENT);
    expect(permissions).toContain('reply.create_internal');
    expect(permissions).not.toContain('ticket.assign');

    const index = await page(base, '/escalated/admin/users', as(ROLE_MANAGER));
    expect(index.props.users.data.find((u: any) => u.id === AGENT).roles).toEqual(['light_agent']);
  });

  it('gives a role to a user with no agent profile yet, and clears it with []', async () => {
    expect((await put(PLAIN, { role_ids: [light] })).status).toBe(303);
    expect(await profileRole(source, PLAIN)).toBe(light);

    expect((await put(PLAIN, { role_ids: [] })).status).toBe(303);
    expect(await profileRole(source, PLAIN)).toBeNull();
  });

  it('keeps the newly ticked role when the picker sends the current one too', async () => {
    expect((await put(AGENT, { role_ids: [agent, light] })).status).toBe(303);
    expect(await profileRole(source, AGENT)).toBe(light);
  });

  it('refuses two new roles at once, since an agent has one role', async () => {
    const res = await put(AGENT, { role_ids: [light, admin] });
    expect(res.status).toBe(303);
    expect(Object.keys((await follow(res)).props.errors)).toEqual(['role_ids']);
    expect(await profileRole(source, AGENT)).toBe(agent);
  });

  it("validates role_ids as Laravel's rules do", async () => {
    for (const body of [{}, { role_ids: 'admin' }, { role_ids: ['x'] }, { role_ids: [987654] }]) {
      const res = await put(AGENT, body);
      expect(res.status).toBe(303);
      const errors = (await follow(res)).props.errors;
      expect(Object.keys(errors).length).toBe(1);
      expect(Object.keys(errors)[0]).toMatch(/^role_ids(\.0)?$/);
    }
    expect(await profileRole(source, AGENT)).toBe(agent);
  });

  it('needs role.manage (403)', async () => {
    const perms = await source
      .getRepository(Permission)
      .find({ where: [{ slug: 'user.view' }, { slug: 'user.manage' }] });
    const custom = await source
      .getRepository(Role)
      .save({ name: 'User admins', slug: 'user-admins', permissions: perms });
    await giveRole(source, ROLE_MANAGER, custom.id);

    expect((await put(AGENT, { role_ids: [light] })).status).toBe(403);
    expect(await profileRole(source, AGENT)).toBe(agent);
  });

  it('does not let a role manager remove their own role management', async () => {
    const res = await put(ROLE_MANAGER, { role_ids: [light] });
    expect(res.status).toBe(303);
    expect((await follow(res)).props.flash.error).toBe(
      'You cannot remove your own role management.',
    );
    expect(await profileRole(source, ROLE_MANAGER)).toBe(admin);
  });

  it('answers 404 for a user the host does not know', async () => {
    const res = await put(UNKNOWN, { role_ids: [light] });
    expect(res.status).toBe(303);
    expect((await follow(res)).props.flash.error).toBe('User not found');
    expect(await profileRole(source, UNKNOWN)).toBeNull();
  });
});
