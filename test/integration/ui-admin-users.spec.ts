import { INestApplication } from '@nestjs/common';
import type { EscalatedUiHostUser, EscalatedUiRoleChange, EscalatedUiUserQuery } from '../../src';
import { ADMIN, bootUi, cookieFrom, expectManifestProps, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * `Escalated/Admin/Users/Index` over real HTTP, with escalated-laravel's
 * Admin\UserController as the contract. The users are the host's, reached
 * through `ui.listUsers` and `ui.updateUserRoles`; without those hooks the
 * page still renders, empty, with a notice.
 */
describe('admin users screen (ui.enabled)', () => {
  const asAdmin = { as: 'admin' as const };

  describe('with the host hooks', () => {
    let app: INestApplication;
    let base: string;
    let people: EscalatedUiHostUser[];
    const queries: EscalatedUiUserQuery[] = [];
    const changes: Array<[string, EscalatedUiRoleChange]> = [];

    const follow = (res: Response) =>
      page(base, res.headers.get('location')!, {
        ...asAdmin,
        headers: { cookie: cookieFrom(res) },
      });

    const toggle = (user: string | number, body: unknown) =>
      inertiaFetch(base, `/escalated/admin/users/${user}/role`, {
        ...asAdmin,
        method: 'PATCH',
        body,
        headers: { referer: `${base}/escalated/admin/users?search=ana` },
      });

    beforeAll(async () => {
      people = [
        { id: ADMIN, name: 'Ada Admin', email: 'ada@example.com', isAdmin: true, isAgent: true },
        ...Array.from({ length: 24 }, (_, i) => ({
          id: 100 + i,
          name: `Person ${i}`,
          email: `p${i}@example.com`,
          isAgent: i === 0,
        })),
      ];
      ({ app, base } = await bootUi({
        ui: {
          enabled: true,
          listUsers: ({ search, page: current, perPage }) => {
            queries.push({ search, page: current, perPage });
            const matching = people.filter(
              (u) => !search || `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()),
            );
            return {
              data: matching.slice((current - 1) * perPage, current * perPage),
              total: matching.length,
            };
          },
          updateUserRoles: async (userId, change) => {
            const user = people.find((u) => String(u.id) === userId);
            if (!user) return false;
            changes.push([userId, change]);
            Object.assign(user, change);
          },
        },
      }));
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(() => {
      queries.length = 0;
      changes.length = 0;
    });

    it('keeps the screen behind the admin guard', async () => {
      expect((await inertiaFetch(base, '/escalated/admin/users', { as: 'agent' })).status).toBe(
        403,
      );
      expect(
        (
          await inertiaFetch(base, '/escalated/admin/users/100/role', {
            as: 'agent',
            method: 'PATCH',
            body: { role: 'agent', value: true },
          })
        ).status,
      ).toBe(403);
      expect(changes).toEqual([]);
    });

    it("lists a page of host users with Laravel's props and paginator", async () => {
      const result = await page(base, '/escalated/admin/users', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Users/Index');
      expectManifestProps(result);
      expect(result.props.filters).toEqual({ search: '' });
      expect(result.props.currentUserId).toBe(ADMIN);
      expect(result.props.notice).toBeNull();

      const users = result.props.users;
      expect(users).toMatchObject({
        current_page: 1,
        last_page: 2,
        per_page: 20,
        total: 25,
        from: 1,
        to: 20,
      });
      expect(Array.isArray(users.links)).toBe(true);
      expect(users.links.length).toBeGreaterThan(3);
      expect(users.next_page_url).toBe('/escalated/admin/users?page=2');
      expect(users.data).toHaveLength(20);
      expect(users.data[0]).toEqual({
        id: ADMIN,
        name: 'Ada Admin',
        email: 'ada@example.com',
        is_admin: true,
        is_agent: true,
      });
      expect(users.data[1]).toEqual({
        id: 100,
        name: 'Person 0',
        email: 'p0@example.com',
        is_admin: false,
        is_agent: true,
      });
      expect(queries).toEqual([{ search: '', page: 1, perPage: 20 }]);

      const second = await page(base, '/escalated/admin/users?page=2', asAdmin);
      expect(second.props.users).toMatchObject({ current_page: 2, from: 21, to: 25 });
      expect(second.props.users.data).toHaveLength(5);
    });

    it('passes the search to the host and keeps it in the filters and page links', async () => {
      const result = await page(base, '/escalated/admin/users?search=%20person%201%20', asAdmin);
      expect(queries).toEqual([{ search: 'person 1', page: 1, perPage: 20 }]);
      expect(result.props.filters).toEqual({ search: 'person 1' });
      expect(result.props.users.total).toBe(11);
      expect(result.props.users.first_page_url).toBe(
        '/escalated/admin/users?search=person+1&page=1',
      );
    });

    it("applies Laravel's admin/agent rules and redirects back with a flash", async () => {
      const grant = await toggle(105, { role: 'admin', value: true });
      expect(grant.status).toBe(303);
      expect(grant.headers.get('location')).toBe('/escalated/admin/users?search=ana');
      expect((await follow(grant)).props.flash.success).toBe('User updated.');

      await toggle(105, { role: 'admin', value: false });
      await toggle(106, { role: 'agent', value: true });
      await toggle(105, { role: 'agent', value: false });

      expect(changes).toEqual([
        ['105', { isAdmin: true, isAgent: true }],
        ['105', { isAdmin: false }],
        ['106', { isAgent: true }],
        ['105', { isAgent: false, isAdmin: false }],
      ]);
    });

    it('refuses removing your own admin role, and invalid input', async () => {
      const self = await toggle(ADMIN, { role: 'admin', value: false });
      expect(self.status).toBe(303);
      expect((await follow(self)).props.flash.error).toBe('You cannot remove your own admin role.');

      const bad = await toggle(105, { role: 'owner', value: 'maybe' });
      expect(bad.status).toBe(303);
      expect(Object.keys((await follow(bad)).props.errors).sort()).toEqual(['role', 'value']);

      expect(changes).toEqual([]);
    });

    it('goes back with an error for a user the host does not know (a 404 on the screen)', async () => {
      const res = await toggle(999, { role: 'agent', value: true });
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.error).toBe('User not found');
    });
  });

  describe('without the host hooks', () => {
    let app: INestApplication;
    let base: string;

    beforeAll(async () => {
      ({ app, base } = await bootUi({ ui: { enabled: true } }));
    });

    afterAll(async () => {
      await app?.close();
    });

    it('renders an empty page that says why', async () => {
      const result = await page(base, '/escalated/admin/users?search=ada', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Users/Index');
      expectManifestProps(result);
      expect(result.props.users).toMatchObject({ data: [], total: 0, current_page: 1, from: null });
      expect(result.props.filters).toEqual({ search: 'ada' });
      expect(result.props.currentUserId).toBe(ADMIN);
      expect(result.props.notice).toMatch(/ui\.listUsers/);
    });

    it('turns a toggle away with an error flash instead of failing', async () => {
      const res = await inertiaFetch(base, '/escalated/admin/users/5/role', {
        ...asAdmin,
        method: 'PATCH',
        body: { role: 'agent', value: true },
      });
      expect(res.status).toBe(303);
      const next = await page(base, res.headers.get('location')!, {
        ...asAdmin,
        headers: { cookie: cookieFrom(res) },
      });
      expect(next.props.flash.error).toMatch(/ui\.updateUserRoles/);
    });
  });
});
