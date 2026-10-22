import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Automation, Macro, Ticket, TicketStatus } from '../../src/entities';
import { statusCategory } from '../../src/entities/status-category';
import { AutomationService } from '../../src/services/automation.service';
import { WorkflowExecutorService } from '../../src/services/workflow-executor.service';
import {
  apiFetch,
  bootUi,
  cookieFrom,
  CUSTOMER,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * Status categories over real HTTP and SQLite: every status belongs to one of
 * escalated-laravel's five categories, lifecycle keys off the category, and
 * every status-change path (agent API, screen action, bulk, macro, workflow,
 * automation) accepts a custom status by slug or id.
 */
describe('status categories', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let resolved: TicketStatus;
  let fixed: TicketStatus;
  let parts: TicketStatus;
  let events: Array<[string, any]>;
  let seq = 0;

  const asAdmin = { as: 'admin' as const };
  const statuses = () => source.getRepository(TicketStatus);
  const tickets = () => source.getRepository(Ticket);

  /** A custom status saved with only its category, as the admin screen saves one. */
  const custom = async (name: string, slug: string, category: string) => {
    await statuses()
      .createQueryBuilder()
      .insert()
      .values({ name, slug, category: category as any, isClosed: false })
      .execute();
    return statuses().findOneByOrFail({ slug });
  };

  const ticket = (extra: Partial<Ticket> = {}) =>
    tickets().save({
      referenceNumber: `SC-${++seq}`,
      subject: 'Categories',
      description: 'x',
      priority: 'medium',
      channel: 'web',
      requesterId: CUSTOMER,
      statusId: open.id,
      ...extra,
    } as Partial<Ticket>);

  const fresh = (id: number) => tickets().findOneByOrFail({ id });
  /** Event names as the shared vocabulary spells them (the emitter prefixes `escalated.`). */
  const names = () => events.map(([name]) => name.replace(/^escalated\./, ''));

  /** A screen action as the shared UI posts it; answers with a redirect. */
  const action = (path: string, body: unknown) =>
    inertiaFetch(base, path, { ...asAdmin, body, headers: { referer: `${base}/escalated/admin` } });

  const submit = (path: string, body: unknown, method = 'POST', from = path) =>
    inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body,
      headers: { referer: `${base}${from}` },
    });
  const follow = (res: Response) =>
    page(base, res.headers.get('location')!, { ...asAdmin, headers: { cookie: cookieFrom(res) } });

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    open = await statuses().save({
      name: 'Open',
      slug: 'open',
      isDefault: true,
      isSystem: true,
      sortOrder: 1,
    });
    resolved = await statuses().save({
      name: 'Resolved',
      slug: 'resolved',
      isClosed: true,
      isSystem: true,
    });
    fixed = await custom('Fixed', 'fixed', 'solved');
    parts = await custom('Awaiting parts', 'awaiting_parts', 'pending');
    app.get(EventEmitter2).onAny((name: any, payload: any) => {
      events.push([String(name), payload]);
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    events = [];
  });

  describe('the status-change paths', () => {
    it('closes a ticket through the agent API by statusId when the category is solved', async () => {
      const t = await ticket();
      const res = await apiFetch(base, `/escalated/agent/tickets/${t.id}`, {
        ...asAdmin,
        method: 'PUT',
        body: { statusId: fixed.id },
      });
      expect(res.status).toBe(200);
      const after = await fresh(t.id);
      expect(after.statusId).toBe(fixed.id);
      expect(after.resolvedAt).not.toBeNull();
      expect(after.closedAt).not.toBeNull();
      expect(names()).toEqual(expect.arrayContaining(['ticket.status_changed', 'ticket.closed']));
    });

    it('closes a ticket from the screen action by custom slug', async () => {
      const t = await ticket();
      const res = await action(`/escalated/agent/tickets/${t.referenceNumber}/status`, {
        status: 'fixed',
      });
      expect(res.status).toBe(303);
      expect((await fresh(t.id)).resolvedAt).not.toBeNull();
      expect(names()).toContain('ticket.status_changed');
    });

    it('keeps a pending ticket open: no resolvedAt, still in the open queue', async () => {
      const before = (await page(base, '/escalated/agent', asAdmin)).props.stats.open;
      const t = await ticket();
      await action(`/escalated/agent/tickets/${t.referenceNumber}/status`, {
        status: 'awaiting_parts',
      });
      const after = await fresh(t.id);
      expect(after.statusId).toBe(parts.id);
      expect(after.resolvedAt).toBeNull();
      expect(names()).toContain('ticket.status_changed');
      expect(names()).not.toContain('ticket.closed');
      expect((await page(base, '/escalated/agent', asAdmin)).props.stats.open).toBe(before + 1);
    });

    it('leaves a ticket with a solved custom status out of the open queue', async () => {
      const before = (await page(base, '/escalated/agent', asAdmin)).props.stats.open;
      // Written straight to the row: the queue reads the status's category.
      await ticket({ statusId: fixed.id });
      expect((await page(base, '/escalated/agent', asAdmin)).props.stats.open).toBe(before);
    });

    it('applies a custom status from the bulk action', async () => {
      const t = await ticket();
      const res = await action('/escalated/admin/tickets/bulk', {
        ticket_ids: [t.id],
        action: 'status',
        value: 'fixed',
      });
      expect(res.status).toBe(303);
      expect((await fresh(t.id)).resolvedAt).not.toBeNull();
    });

    it('applies a custom status from a macro, through the normal path', async () => {
      const macro = await source.getRepository(Macro).save({
        name: 'Mark fixed',
        scope: 'shared',
        isActive: true,
        actions: [{ type: 'status', value: 'fixed' }],
      } as Partial<Macro>);
      const t = await ticket();
      const res = await action(`/escalated/agent/tickets/${t.referenceNumber}/macro`, {
        macro_id: macro.id,
      });
      expect(res.status).toBe(303);
      const after = await fresh(t.id);
      expect(after.statusId).toBe(fixed.id);
      expect(after.resolvedAt).not.toBeNull();
      expect(names()).toEqual(expect.arrayContaining(['ticket.status_changed', 'ticket.closed']));
    });

    it('applies a custom status from a workflow action, through the normal path', async () => {
      const t = await ticket();
      await app
        .get(WorkflowExecutorService)
        .execute(await fresh(t.id), [{ type: 'change_status', value: 'fixed' }]);
      const after = await fresh(t.id);
      expect(after.statusId).toBe(fixed.id);
      expect(after.resolvedAt).not.toBeNull();
      expect(names().filter((n) => n === 'ticket.status_changed')).toHaveLength(1);
    });

    it('applies a custom status from an automation by slug', async () => {
      const t = await ticket({ subject: 'Automate me' });
      await source.getRepository(Automation).save({
        name: 'Close parts',
        active: true,
        conditions: [{ field: 'subject_contains', value: 'Automate me' }],
        actions: [{ type: 'change_status', value: 'fixed' }],
      } as Partial<Automation>);
      await app.get(AutomationService).run();
      const after = await fresh(t.id);
      expect(after.statusId).toBe(fixed.id);
      expect(after.resolvedAt).not.toBeNull();
      expect(names()).toContain('ticket.status_changed');
    });

    it('announces a move between two statuses of one category', async () => {
      const t = await ticket({ statusId: fixed.id });
      await action(`/escalated/agent/tickets/${t.referenceNumber}/status`, { status: 'resolved' });
      expect((await fresh(t.id)).statusId).toBe(resolved.id);
      expect(names()).toEqual(expect.arrayContaining(['ticket.status_changed', 'ticket.resolved']));
    });

    it('lets a customer close to a solved status and reopen to an open one', async () => {
      const t = await ticket();
      const asCustomer = (path: string) =>
        inertiaFetch(base, path, {
          as: 'customer',
          body: {},
          headers: { referer: `${base}/escalated/customer/tickets/${t.referenceNumber}` },
        });
      expect(
        (await asCustomer(`/escalated/customer/tickets/${t.referenceNumber}/close`)).status,
      ).toBe(303);
      const closed = await tickets().findOneOrFail({
        where: { id: t.id },
        relations: { status: true },
      });
      // Seeded without a category: it takes `solved` from isClosed.
      expect(statusCategory(closed.status)).toBe('solved');
      expect(closed.resolvedAt).not.toBeNull();

      // A default in the solved category is never what a reopen picks.
      await statuses().update({ id: fixed.id }, { isDefault: true });
      try {
        await asCustomer(`/escalated/customer/tickets/${t.referenceNumber}/reopen`);
        expect((await fresh(t.id)).statusId).toBe(open.id);
        expect(names()).toContain('ticket.reopened');
      } finally {
        await statuses().update({ id: fixed.id }, { isDefault: false });
      }
    });

    it('serialises the category and the custom status on the agent ticket', async () => {
      const t = await ticket({ statusId: parts.id });
      const shown = await page(base, `/escalated/admin/tickets/${t.referenceNumber}`, asAdmin);
      expect(shown.props.ticket).toMatchObject({
        status: 'awaiting_parts',
        status_category: 'pending',
        custom_status: {
          id: parts.id,
          label: 'Awaiting parts',
          slug: 'awaiting_parts',
          category: 'pending',
        },
      });
      const system = await page(
        base,
        `/escalated/admin/tickets/${(await ticket()).referenceNumber}`,
        asAdmin,
      );
      expect(system.props.ticket).toMatchObject({ status_category: 'open', custom_status: null });
    });
  });

  describe('Escalated/Admin/Statuses', () => {
    it('lists every status with Laravel’s five categories and keys', async () => {
      const result = await page(base, '/escalated/admin/statuses', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Statuses/Index');
      expectManifestProps(result);
      expect(result.props.categories).toEqual(['new', 'open', 'pending', 'on_hold', 'solved']);
      const keys = [
        'id',
        'label',
        'slug',
        'category',
        'color',
        'description',
        'position',
        'is_default',
        'is_system',
        'created_at',
        'updated_at',
        'name',
        'is_closed',
      ];
      for (const status of result.props.statuses)
        expect(Object.keys(status).sort()).toEqual([...keys].sort());
      expect(result.props.statuses.find((s: any) => s.slug === 'open')).toMatchObject({
        category: 'open',
        is_system: true,
        is_default: true,
      });
      expect(result.props.statuses.find((s: any) => s.slug === 'fixed')).toMatchObject({
        category: 'solved',
        is_system: false,
        is_closed: true,
      });
      // Ordered by category, then position.
      const order = result.props.statuses.map((s: any) =>
        result.props.categories.indexOf(s.category),
      );
      expect(order).toEqual([...order].sort((a: number, b: number) => a - b));
    });

    it('creates a status in any category with a description, default per category', async () => {
      const form = await page(base, '/escalated/admin/statuses/create', asAdmin);
      expect(form.component).toBe('Escalated/Admin/Statuses/Form');
      expectManifestProps(form);
      expect(form.props.categories).toEqual(['new', 'open', 'pending', 'on_hold', 'solved']);

      const res = await submit('/escalated/admin/statuses', {
        label: 'On hold for vendor',
        category: 'on_hold',
        color: '#123456',
        description: 'Waiting on a third party',
        position: 2,
        is_default: true,
      });
      expect(res.status).toBe(303);
      const saved = await statuses().findOneByOrFail({ slug: 'on_hold_for_vendor' });
      expect(saved).toMatchObject({
        category: 'on_hold',
        description: 'Waiting on a third party',
        isDefault: true,
        isSystem: false,
        isClosed: false,
      });
      // Another category's default is untouched, and new tickets still get it.
      expect((await statuses().findOneByOrFail({ id: open.id })).isDefault).toBe(true);
      const created = await apiFetch(base, '/escalated/agent/tickets', {
        ...asAdmin,
        body: { subject: 'Default status', description: 'x' },
      });
      expect((await created.json()).statusId).toBe(open.id);

      const edit = await page(base, `/escalated/admin/statuses/${saved.id}/edit`, asAdmin);
      expect(edit.props.status).toMatchObject({
        id: saved.id,
        label: 'On hold for vendor',
        category: 'on_hold',
        description: 'Waiting on a third party',
        is_system: false,
      });

      // A second default in the same category replaces the first.
      await submit('/escalated/admin/statuses', {
        label: 'Parked',
        category: 'on_hold',
        color: '#654321',
        is_default: true,
      });
      expect((await statuses().findOneByOrFail({ id: saved.id })).isDefault).toBe(false);
      expect((await statuses().findOneByOrFail({ slug: 'parked' })).isDefault).toBe(true);
    });

    it('moves a custom status to another category, keeping tickets as they are', async () => {
      const status = await custom('Later', 'later', 'pending');
      const t = await ticket({ statusId: status.id });
      await submit(
        `/escalated/admin/statuses/${status.id}`,
        { label: 'Later', category: 'solved', color: '#000000' },
        'PUT',
      );
      expect(await statuses().findOneByOrFail({ id: status.id })).toMatchObject({
        category: 'solved',
        isClosed: true,
      });
      expect((await fresh(t.id)).resolvedAt).toBeNull();
    });

    it('lets a system status be relabelled but not re-categorised or deleted', async () => {
      const ok = await submit(
        `/escalated/admin/statuses/${open.id}`,
        { label: 'Open (new)', category: 'open', color: '#00aa00', is_default: true },
        'PUT',
      );
      expect(ok.status).toBe(303);
      expect(await statuses().findOneByOrFail({ id: open.id })).toMatchObject({
        name: 'Open (new)',
        slug: 'open',
        color: '#00aa00',
      });

      const moved = await submit(
        `/escalated/admin/statuses/${open.id}`,
        { label: 'Open', category: 'solved', color: '#00aa00' },
        'PUT',
        `/escalated/admin/statuses/${open.id}/edit`,
      );
      expect(Object.keys((await follow(moved)).props.errors)).toEqual(['category']);
      expect((await statuses().findOneByOrFail({ id: open.id })).category).not.toBe('solved');

      const unused = await statuses().save({ name: 'Snoozed', slug: 'snoozed', isSystem: true });
      const gone = await submit(
        `/escalated/admin/statuses/${unused.id}`,
        undefined,
        'DELETE',
        '/escalated/admin/statuses',
      );
      expect((await follow(gone)).props.flash.error).toMatch(/System statuses/);
      expect(await statuses().countBy({ id: unused.id })).toBe(1);
    });

    it('validates as escalated-laravel does', async () => {
      const bad = await submit(
        '/escalated/admin/statuses',
        { label: '', category: 'archived', color: '#000000', position: 'x' },
        'POST',
        '/escalated/admin/statuses/create',
      );
      expect((await follow(bad)).props.errors).toHaveProperty('label');
      const badCategory = await submit(
        '/escalated/admin/statuses',
        { label: 'X', category: 'archived', color: '#000000' },
        'POST',
        '/escalated/admin/statuses/create',
      );
      expect(Object.keys((await follow(badCategory)).props.errors)).toEqual(['category']);
    });

    it('keeps the screens for admins', async () => {
      expect(
        (await inertiaFetch(base, '/escalated/admin/statuses/create', { as: 'agent' })).status,
      ).toBe(403);
    });
  });
});
