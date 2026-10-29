import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AgentProfile,
  ApiToken,
  Permission,
  Role,
  Reply,
  Ticket,
  TicketStatus,
} from '../../src/entities';
import { EscalatedAdminGuard } from '../../src/guards/escalated-route.guard';
import { ApiTokenGuard } from '../../src/guards/api-token.guard';
import { ApiTokenService } from '../../src/services/api-token.service';
import { RoleService } from '../../src/services/role.service';
import { PERMISSIONS, seedRolesAndPermissions } from '../../src/access/permission-seed';
import {
  ROUTE_PERMISSIONS,
  isRouteMapped,
  normalizeRoutePath,
} from '../../src/access/route-permissions';
import { apiFetch, bootUi, CUSTOMER, inertiaFetch, page } from './ui-harness';
import { bootEscalatedModule } from './boot-escalated-module';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessControlService } from '../../src/access/access-control.service';
import { NewsletterPermissionService } from '../../src/services/newsletter/newsletter-permission.service';
import { AdminNewsletterController } from '../../src/controllers/newsletter/admin-newsletter.controller';
import { AdminNewsletterListController } from '../../src/controllers/newsletter/admin-newsletter-list.controller';
import { AdminNewsletterSettingsController } from '../../src/controllers/newsletter/admin-newsletter-settings.controller';
import { AdminNewsletterTemplateController } from '../../src/controllers/newsletter/admin-newsletter-template.controller';

jest.setTimeout(120000);

/**
 * ADR 2026-10-29-configurable-access-features: roles & permissions is an
 * install-level switch (`access.rolesPermissions` / ESCALATED_ROLES_PERMISSIONS).
 * Off, the host guards decide everything and the roles screens answer 404.
 * On, every admin and agent route also needs its permission from the user's
 * Escalated role.
 */

/** A host route under the admin area that the permission map does not know. */
@UseGuards(EscalatedAdminGuard)
@Controller('escalated/admin/not-in-the-map')
class UnmappedAdminController {
  @Get()
  index() {
    return { ok: true };
  }
}

let nextUser = 500;

interface World {
  app: INestApplication;
  source: DataSource;
  base: string;
  open: TicketStatus;
  closed: TicketStatus;
  resolved: TicketStatus;
  inProgress: TicketStatus;
}

async function world(
  rolesPermissions: boolean,
  extra: Record<string, unknown> = {},
): Promise<World> {
  const { app, source, base } = await bootUi({ access: { rolesPermissions }, ...extra } as any, {
    controllers: [UnmappedAdminController],
  });
  await seedRolesAndPermissions(source.manager);
  const statuses = source.getRepository(TicketStatus);
  const open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
  const closed = await statuses.save({ name: 'Closed', slug: 'closed', isClosed: true });
  const resolved = await statuses.save({ name: 'Resolved', slug: 'resolved', isClosed: true });
  const inProgress = await statuses.save({ name: 'In progress', slug: 'in_progress' });
  return { app, source, base, open, closed, resolved, inProgress };
}

let seq = 0;
async function ticket(w: World): Promise<Ticket> {
  seq += 1;
  const repo = w.source.getRepository(Ticket);
  return repo.save(
    repo.create({
      referenceNumber: `RP-${1000 + seq}`,
      subject: `Ticket ${seq}`,
      description: 'Something broke',
      priority: 'medium',
      channel: 'web',
      statusId: w.open.id,
      requesterId: CUSTOMER,
      guestAccessToken: `rp-token-${seq}`,
    }),
  );
}

/** A staff user (admin and agent guards, or agent only) with the given role slug or permissions. */
async function staff(
  w: World,
  kind: 'admin' | 'agent',
  role?: string | string[],
): Promise<{ id: number; headers: Record<string, string> }> {
  const id = (nextUser += 1);
  let roleId: number | null = null;
  if (typeof role === 'string') {
    roleId = (await w.source.getRepository(Role).findOneByOrFail({ slug: role })).id;
  } else if (Array.isArray(role)) {
    const perms = await w.source
      .getRepository(Permission)
      .find({ where: role.map((slug) => ({ slug })) });
    const custom = await w.source
      .getRepository(Role)
      .save({ name: `Custom ${id}`, slug: `custom-${id}`, permissions: perms });
    roleId = custom.id;
  }
  if (roleId !== null) {
    await w.source.getRepository(AgentProfile).save({ userId: id, roleId } as any);
  }
  return {
    id,
    headers: { 'x-role': kind === 'admin' ? 'agent,admin' : 'agent', 'x-user': String(id) },
  };
}

const post = (w: World, path: string, who: { headers: Record<string, string> }, body: unknown) =>
  inertiaFetch(w.base, path, { body, headers: { ...who.headers, referer: `${w.base}${path}` } });

const visit = (w: World, path: string, who: { headers: Record<string, string> }) =>
  inertiaFetch(w.base, path, { headers: who.headers });

describe('roles & permissions switched off (the default)', () => {
  let w: World;
  beforeAll(async () => {
    w = await world(false);
  });
  afterAll(async () => {
    await w?.app.close();
  });

  it('is off without configuration', async () => {
    const { accessFeatureEnabled } = await import('../../src/access/access-features');
    expect(accessFeatureEnabled({}, 'roles_permissions')).toBe(false);
  });

  it('hides the roles screens and API (404)', async () => {
    const admin = await staff(w, 'admin', 'admin');
    expect((await visit(w, '/escalated/admin/roles', admin)).status).toBe(404);
    expect((await visit(w, '/escalated/admin/roles/create', admin)).status).toBe(404);
    expect((await post(w, '/escalated/admin/roles', admin, { name: 'X' })).status).toBe(404);
    expect(
      (await apiFetch(w.base, '/escalated/admin/permissions', { headers: admin.headers })).status,
    ).toBe(404);
    expect(await w.source.getRepository(Role).countBy({ name: 'X' })).toBe(0);
  });

  it('lets the guards alone decide', async () => {
    const light = await staff(w, 'agent', 'light_agent');
    const t = await ticket(w);
    const res = await post(w, `/escalated/agent/tickets/${t.referenceNumber}/assign`, light, {
      agent_id: light.id,
    });
    expect(res.status).toBe(303);
    expect((await w.source.getRepository(Ticket).findOneByOrFail({ id: t.id })).assigneeId).toBe(
      light.id,
    );

    const admin = await staff(w, 'admin');
    expect((await visit(w, '/escalated/admin/departments', admin)).status).toBe(200);
  });

  it('shares the switches off and a wildcard permission set for staff', async () => {
    const admin = await staff(w, 'admin');
    const props = (await page(w.base, '/escalated/admin/departments', { headers: admin.headers }))
      .props;
    expect(props.escalated.features).toMatchObject({
      roles_permissions: false,
      two_factor: false,
      sso: false,
    });
    expect(props.escalated.permissions).toEqual(['*']);

    const customer = (
      await page(w.base, '/escalated', {
        headers: { 'x-role': 'customer', 'x-user': String(CUSTOMER) },
      })
    ).props;
    expect(customer.escalated.permissions).toEqual([]);
  });

  it('cannot be turned on from the settings store', async () => {
    const admin = await staff(w, 'admin', 'admin');
    const saved = await apiFetch(w.base, '/escalated/admin/settings', {
      method: 'PUT',
      headers: { ...admin.headers, 'content-type': 'application/json' },
      body: [
        { key: 'roles_permissions', value: 'true' },
        { key: 'access.roles_permissions', value: 'true' },
        { key: 'ESCALATED_ROLES_PERMISSIONS', value: 'true' },
      ],
    });
    expect(saved.status).toBe(200);
    expect((await visit(w, '/escalated/admin/roles', admin)).status).toBe(404);
  });
});

describe('roles & permissions switched on', () => {
  let w: World;
  beforeAll(async () => {
    w = await world(true);
  });
  afterAll(async () => {
    await w?.app.close();
  });

  it('shows the roles screens to a role manager', async () => {
    const admin = await staff(w, 'admin', 'admin');
    const index = await page(w.base, '/escalated/admin/roles', { headers: admin.headers });
    expect(index.component).toBe('Escalated/Admin/Roles/Index');
    expect(index.props.roles.map((r: any) => r.slug)).toEqual(
      expect.arrayContaining(['admin', 'agent', 'light_agent']),
    );
    const form = await page(w.base, '/escalated/admin/roles/create', { headers: admin.headers });
    expect(form.component).toBe('Escalated/Admin/Roles/Form');
  });

  it('grants nothing to an admin without a role', async () => {
    const admin = await staff(w, 'admin');
    expect((await visit(w, '/escalated/admin/departments', admin)).status).toBe(403);
    expect((await visit(w, '/escalated/admin/roles', admin)).status).toBe(403);
    expect((await post(w, '/escalated/admin/settings', admin, {})).status).toBe(403);
  });

  it('lets an admin with the admin role through', async () => {
    const admin = await staff(w, 'admin', 'admin');
    expect((await visit(w, '/escalated/admin/departments', admin)).status).toBe(200);
    expect((await visit(w, '/escalated/admin/settings', admin)).status).toBe(200);
  });

  it('checks admin reads and writes against separate permissions', async () => {
    const admin = await staff(w, 'admin', ['department.view']);
    expect((await visit(w, '/escalated/admin/departments', admin)).status).toBe(200);
    expect((await post(w, '/escalated/admin/departments', admin, { name: 'Billing' })).status).toBe(
      403,
    );
    expect((await visit(w, '/escalated/admin/webhooks', admin)).status).toBe(403);
  });

  it("shares the user's permission slugs and the switch", async () => {
    const admin = await staff(w, 'admin', ['department.view']);
    const props = (await page(w.base, '/escalated/admin/departments', { headers: admin.headers }))
      .props;
    expect(props.escalated.features.roles_permissions).toBe(true);
    expect(props.escalated.permissions).toEqual(['department.view']);
  });

  it('limits a light agent to viewing and notes', async () => {
    const light = await staff(w, 'agent', 'light_agent');
    const t = await ticket(w);
    const show = `/escalated/agent/tickets/${t.referenceNumber}`;

    expect((await visit(w, show, light)).status).toBe(200);
    expect((await post(w, `${show}/note`, light, { body: 'Internal' })).status).toBe(303);
    expect(await w.source.getRepository(Reply).countBy({ ticketId: t.id, isInternal: true })).toBe(
      1,
    );

    expect((await post(w, `${show}/assign`, light, { agent_id: light.id })).status).toBe(403);
    expect((await post(w, `${show}/priority`, light, { priority: 'high' })).status).toBe(403);
    expect((await post(w, `${show}/status`, light, { status: 'closed' })).status).toBe(403);
    const del = await apiFetch(w.base, `/escalated/agent/tickets/${t.id}`, {
      method: 'DELETE',
      headers: light.headers,
    });
    expect(del.status).toBe(403);

    const after = await w.source.getRepository(Ticket).findOneByOrFail({ id: t.id });
    expect(after.assigneeId).toBeNull();
    expect(after.priority).toBe('medium');
    expect(after.statusId).toBe(w.open.id);
  });

  it('lets a full agent assign', async () => {
    const agent = await staff(w, 'agent', 'agent');
    const t = await ticket(w);
    const res = await post(w, `/escalated/agent/tickets/${t.referenceNumber}/assign`, agent, {
      agent_id: agent.id,
    });
    expect(res.status).toBe(303);
    expect((await w.source.getRepository(Ticket).findOneByOrFail({ id: t.id })).assigneeId).toBe(
      agent.id,
    );
  });

  it('needs ticket.close only to close, resolve or reopen', async () => {
    const editor = await staff(w, 'agent', ['ticket.view', 'ticket.edit']);
    const t = await ticket(w);
    const show = `/escalated/agent/tickets/${t.referenceNumber}`;

    expect((await post(w, `${show}/status`, editor, { status: 'closed' })).status).toBe(403);
    expect((await post(w, `${show}/status`, editor, { status: 'resolved' })).status).toBe(403);
    expect((await post(w, `${show}/status`, editor, { status: 'in_progress' })).status).toBe(303);
    expect((await w.source.getRepository(Ticket).findOneByOrFail({ id: t.id })).statusId).toBe(
      w.inProgress.id,
    );

    // The JSON update names the status by id: a solved one needs ticket.close too.
    const put = (body: unknown) =>
      apiFetch(w.base, `/escalated/agent/tickets/${t.id}`, {
        method: 'PUT',
        headers: { ...editor.headers, 'content-type': 'application/json' },
        body,
      });
    expect((await put({ statusId: w.closed.id })).status).toBe(403);
    expect((await put({ assigneeId: editor.id })).status).toBe(403);
    expect((await put({ priority: 'high' })).status).toBe(200);

    const closer = await staff(w, 'agent', ['ticket.view', 'ticket.edit', 'ticket.close']);
    expect((await post(w, `${show}/status`, closer, { status: 'resolved' })).status).toBe(303);
  });

  it('checks each bulk action against its own permission', async () => {
    const admin = await staff(w, 'admin', 'light_agent');
    const t = await ticket(w);
    const bulk = (body: unknown) => post(w, '/escalated/admin/tickets/bulk', admin, body);

    expect((await bulk({ ticket_ids: [t.id], action: 'assign', value: admin.id })).status).toBe(
      403,
    );
    expect((await bulk({ ticket_ids: [t.id], action: 'delete' })).status).toBe(403);
    expect((await bulk({ ticket_ids: [t.id], action: 'status', value: 'closed' })).status).toBe(
      403,
    );

    const after = await w.source.getRepository(Ticket).findOneBy({ id: t.id });
    expect(after).not.toBeNull();
    expect(after!.assigneeId).toBeNull();

    const editor = await staff(w, 'admin', ['ticket.view', 'ticket.edit']);
    const ok = await post(w, '/escalated/admin/tickets/bulk', editor, {
      ticket_ids: [t.id],
      action: 'priority',
      value: 'high',
    });
    expect(ok.status).toBe(303);
  });

  it('needs reply.create_internal for an internal JSON reply', async () => {
    const replier = await staff(w, 'agent', ['ticket.view', 'reply.create']);
    const t = await ticket(w);
    const reply = (body: unknown) =>
      apiFetch(w.base, `/escalated/agent/tickets/${t.id}/replies`, {
        headers: { ...replier.headers, 'content-type': 'application/json' },
        body,
      });
    expect((await reply({ body: 'Note', isInternal: true })).status).toBe(403);
    expect((await reply({ body: 'Hello' })).status).toBe(201);
  });

  it('bootstraps an admin with RoleService.assignRole', async () => {
    const id = (nextUser += 1);
    const headers = { 'x-role': 'agent,admin', 'x-user': String(id) };
    expect((await visit(w, '/escalated/admin/departments', { headers })).status).toBe(403);
    await w.app.get(RoleService).assignRole(id, 'admin');
    expect((await visit(w, '/escalated/admin/departments', { headers })).status).toBe(200);
    await expect(w.app.get(RoleService).assignRole(id, 'nope')).rejects.toThrow('nope');
  });

  it('refuses a staff route that has no permission mapping', async () => {
    const admin = await staff(w, 'admin', 'admin');
    const res = await apiFetch(w.base, '/escalated/admin/not-in-the-map', {
      headers: admin.headers,
    });
    expect(res.status).toBe(403);
  });
});

describe('roles & permissions with API tokens', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      access: { rolesPermissions: true },
      adminGuard: ApiTokenGuard,
      agentGuard: ApiTokenGuard,
    } as any));
    await seedRolesAndPermissions(source.manager);
    await source.getRepository(TicketStatus).save({ name: 'Open', slug: 'open', isDefault: true });
  });
  afterAll(async () => {
    await app?.close();
  });

  it("checks the token owner's permissions as well as the token's abilities", async () => {
    const light = await source.getRepository(Role).findOneByOrFail({ slug: 'light_agent' });
    await source.getRepository(AgentProfile).save({ userId: 77, roleId: light.id } as any);
    const { plainTextToken } = await app.get(ApiTokenService).create({
      name: 'agent token',
      userId: 77,
      abilities: ['agent'],
    });
    const headers = { authorization: `Bearer ${plainTextToken}`, accept: 'application/json' };
    const status = await source.getRepository(TicketStatus).findOneByOrFail({ slug: 'open' });
    const t = await source.getRepository(Ticket).save({
      referenceNumber: 'API-1',
      subject: 'Token',
      description: 'x',
      priority: 'medium',
      channel: 'web',
      statusId: status.id,
      requesterId: CUSTOMER,
    } as any);

    expect((await fetch(`${base}/escalated/agent/tickets/${t.id}`, { headers })).status).toBe(200);
    const del = await fetch(`${base}/escalated/agent/tickets/${t.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(del.status).toBe(403);
    expect(await source.getRepository(ApiToken).count()).toBe(1);
  });
});

describe('the route permission map', () => {
  const STAFF_PREFIXES = [
    '/escalated/admin',
    '/escalated/agent',
    '/escalated/attachments',
    '/escalated/api/plugins',
    '/admin/newsletters',
  ];

  it('maps every admin and agent route to a permission', async () => {
    // Routes only: no database needed (the newsletter tables are not SQLite-portable).
    const moduleRef = await bootEscalatedModule({
      escalated: { ui: { enabled: true }, enableNewsletters: true } as any,
    });
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      const router = app.getHttpAdapter().getInstance();
      const stack = (router._router ?? router.router).stack as any[];
      const unmapped: string[] = [];
      let checked = 0;
      for (const layer of stack.filter((l) => l.route)) {
        const path = normalizeRoutePath(layer.route.path);
        if (!STAFF_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
          continue;
        const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
        const declared = methods.length > 10 ? ['POST'] : methods; // @All
        for (const method of declared) {
          checked += 1;
          if (!isRouteMapped(method, path)) unmapped.push(`${method} ${path}`);
        }
      }
      expect(checked).toBeGreaterThan(200);
      expect(unmapped).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('names only seeded permissions', () => {
    const seeded = new Set(PERMISSIONS.map(([slug]) => slug));
    const unknown = ROUTE_PERMISSIONS.flatMap(([, , slugs]) => slugs).filter(
      (slug) => !seeded.has(slug),
    );
    expect(unknown).toEqual([]);
  });
});

describe('newsletter permissions', () => {
  const access = (rolesPermissions: boolean, slugs: string[]) => {
    const service = new AccessControlService(
      { findOne: async () => ({ roleId: 1 }) } as any,
      { find: async () => [{ permissions: slugs.map((slug) => ({ slug })) }] } as any,
      {} as any,
      { access: { rolesPermissions } },
    );
    return new NewsletterPermissionService(service);
  };
  const request = { user: { id: 5 } };

  it('keeps the admin guard on every newsletter admin screen', () => {
    for (const controller of [
      AdminNewsletterController,
      AdminNewsletterListController,
      AdminNewsletterSettingsController,
      AdminNewsletterTemplateController,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(EscalatedAdminGuard);
    }
  });

  it('does not check newsletters.* while the switch is off', async () => {
    await expect(access(false, []).require(request, 'newsletters.send')).resolves.toBeUndefined();
  });

  it('checks newsletters.* while the switch is on', async () => {
    await expect(access(true, []).require(request, 'newsletters.manage')).rejects.toThrow(
      'newsletters.manage',
    );
    await expect(
      access(true, ['newsletters.manage']).require(request, 'newsletters.send'),
    ).rejects.toThrow('newsletters.send');
    await expect(
      access(true, ['newsletters.manage', 'newsletters.send']).require(request, 'newsletters.send'),
    ).resolves.toBeUndefined();
  });
});
