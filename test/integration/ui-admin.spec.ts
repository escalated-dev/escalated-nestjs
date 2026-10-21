import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Department,
  EscalatedSettings,
  Tag,
  Ticket,
  TicketStatus,
  Workflow,
} from '../../src/entities';
import { WORKFLOW_TRIGGERS } from '../../src/events/workflow-triggers';
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
 * The admin screens over real HTTP and SQLite: Settings, Workflows, Departments
 * and Tags, with escalated-laravel's admin controllers as the prop contract and
 * the workflow builder's wire contract for its forms.
 */
describe('admin screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;

  const asAdmin = { as: 'admin' as const };

  const EXAMPLE = {
    name: 'Route refunds to billing',
    description: null,
    trigger_event: 'ticket.created',
    conditions: { all: [{ field: 'subject', operator: 'contains', value: 'refund' }] },
    actions: [{ type: 'change_priority', value: 'high' }],
    is_active: true,
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    open = await source
      .getRepository(TicketStatus)
      .save({ name: 'Open', slug: 'open', isDefault: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  const form = (path: string, body: unknown, method = 'POST', referer?: string) =>
    inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body,
      headers: referer ? { referer: `${base}${referer}` } : {},
    });

  it('keeps the admin screens behind the admin guard', async () => {
    const res = await inertiaFetch(base, '/escalated/admin/settings', { as: 'agent' });
    expect(res.status).toBe(403);
  });

  describe('Escalated/Admin/Settings', () => {
    it('sends the settings this backend stores, and only those as supported_settings', async () => {
      const result = await page(base, '/escalated/admin/settings', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Settings');
      expectManifestProps(result);
      expect(result.props.supported_settings.sort()).toEqual(
        [
          'show_powered_by',
          'widget_allowed_origins',
          'widget_color',
          'widget_greeting',
          'widget_position',
        ].sort(),
      );
      expect(result.props.settings).toMatchObject({
        show_powered_by: true,
        widget_color: '#4F46E5',
        widget_position: 'bottom-right',
      });
      expect(result.props.update_url).toBe('/escalated/admin/settings');
    });

    it('saves the supported settings the form sends and ignores the rest', async () => {
      const res = await form(
        '/escalated/admin/settings',
        {
          show_powered_by: false,
          widget_color: '#112233',
          widget_allowed_origins: 'https://shop.example.com\nhttps://*.example.org',
          chat_enabled: true,
        },
        'POST',
        '/escalated/admin/settings',
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/settings');

      const next = await page(base, '/escalated/admin/settings', {
        ...asAdmin,
        headers: { cookie: cookieFrom(res) },
      });
      expect(next.props.flash.success).toBe('Settings updated.');
      expect(next.props.settings).toMatchObject({
        show_powered_by: false,
        widget_color: '#112233',
        widget_allowed_origins: 'https://shop.example.com\nhttps://*.example.org',
      });
      expect(next.props.escalated.show_powered_by).toBe(false);
      expect(await source.getRepository(EscalatedSettings).countBy({ key: 'chat_enabled' })).toBe(
        0,
      );
    });

    it('sends invalid settings back with errors and saves nothing', async () => {
      const res = await form(
        '/escalated/admin/settings',
        { widget_color: 'red', widget_allowed_origins: 'not an origin' },
        'POST',
        '/escalated/admin/settings',
      );
      expect(res.status).toBe(303);
      const next = await page(base, '/escalated/admin/settings', {
        ...asAdmin,
        headers: { cookie: cookieFrom(res) },
      });
      expect(Object.keys(next.props.errors).sort()).toEqual([
        'widget_allowed_origins',
        'widget_color',
      ]);
    });

    it('keeps the JSON settings API', async () => {
      const res = await apiFetch(base, '/escalated/admin/settings', asAdmin);
      expect(Array.isArray(await res.json())).toBe(true);
    });
  });

  describe('Escalated/Admin/Departments', () => {
    it('lists departments with ticket and agent counts', async () => {
      const dept = await source
        .getRepository(Department)
        .save({ name: 'Counted', slug: 'counted', isActive: true });
      await source.getRepository(Ticket).save({
        referenceNumber: 'ADM-1',
        subject: 'x',
        description: 'y',
        priority: 'low',
        channel: 'web',
        statusId: open.id,
        requesterId: CUSTOMER,
        departmentId: dept.id,
        guestAccessToken: 'adm-1',
      });

      const result = await page(base, '/escalated/admin/departments', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Departments/Index');
      expectManifestProps(result);
      expect(result.props.departments).toContainEqual(
        expect.objectContaining({
          id: dept.id,
          name: 'Counted',
          is_active: true,
          tickets_count: 1,
          agents_count: 0,
        }),
      );
    });

    it('creates, edits and deletes through the form screens', async () => {
      const create = await page(base, '/escalated/admin/departments/create', asAdmin);
      expect(create.component).toBe('Escalated/Admin/Departments/Form');
      expectManifestProps(create);
      expect(create.props.department).toBeNull();

      const created = await form('/escalated/admin/departments', {
        name: 'Returns',
        slug: '',
        description: 'Refunds and returns',
        is_active: true,
      });
      expect(created.status).toBe(303);
      expect(created.headers.get('location')).toBe('/escalated/admin/departments');
      const dept = await source.getRepository(Department).findOneByOrFail({ name: 'Returns' });
      expect(dept).toMatchObject({ slug: 'returns', description: 'Refunds and returns' });

      const edit = await page(base, `/escalated/admin/departments/${dept.id}/edit`, asAdmin);
      expect(edit.component).toBe('Escalated/Admin/Departments/Form');
      expect(edit.props.department).toMatchObject({
        id: dept.id,
        name: 'Returns',
        slug: 'returns',
      });

      const updated = await form(
        `/escalated/admin/departments/${dept.id}`,
        { name: 'Returns desk', slug: 'returns', description: '', is_active: false },
        'PUT',
      );
      expect(updated.status).toBe(303);
      expect(await source.getRepository(Department).findOneByOrFail({ id: dept.id })).toMatchObject(
        { name: 'Returns desk', isActive: false },
      );

      const removed = await form(`/escalated/admin/departments/${dept.id}`, undefined, 'DELETE');
      expect(removed.status).toBe(303);
      expect(await source.getRepository(Department).countBy({ id: dept.id })).toBe(0);
    });

    it('sends a missing name back as a field error', async () => {
      const res = await form(
        '/escalated/admin/departments',
        { name: '' },
        'POST',
        '/escalated/admin/departments/create',
      );
      expect(res.headers.get('location')).toBe('/escalated/admin/departments/create');
      const next = await page(base, '/escalated/admin/departments/create', {
        ...asAdmin,
        headers: { cookie: cookieFrom(res) },
      });
      expect(next.props.errors).toEqual({ name: 'The name field is required.' });
    });

    it('keeps the JSON API for departments, unscripted browser forms refused', async () => {
      const json = await apiFetch(base, '/escalated/admin/departments', {
        ...asAdmin,
        body: { name: 'API made', isActive: true },
      });
      expect(json.status).toBe(201);
      expect(await json.json()).toMatchObject({ name: 'API made', slug: 'api-made' });

      const crossSite = await fetch(`${base}/escalated/admin/departments`, {
        method: 'POST',
        headers: {
          accept: 'text/html',
          'content-type': 'application/json',
          'x-role': 'agent,admin',
          'x-user': '1',
        },
        body: JSON.stringify({ name: 'Forged' }),
      });
      expect(crossSite.status).toBe(403);
      expect(await source.getRepository(Department).countBy({ name: 'Forged' })).toBe(0);
    });
  });

  describe('Escalated/Admin/Tags/Index', () => {
    it('lists tags with counts and creates, renames and deletes them', async () => {
      const created = await form(
        '/escalated/admin/tags',
        { name: 'Refund', color: '#06b6d4' },
        'POST',
        '/escalated/admin/tags',
      );
      expect(created.status).toBe(303);
      expect(created.headers.get('location')).toBe('/escalated/admin/tags');
      const tag = await source.getRepository(Tag).findOneByOrFail({ name: 'Refund' });

      const result = await page(base, '/escalated/admin/tags', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Tags/Index');
      expectManifestProps(result);
      expect(result.props.tags).toContainEqual(
        expect.objectContaining({ id: tag.id, name: 'Refund', color: '#06b6d4', tickets_count: 0 }),
      );

      await form(`/escalated/admin/tags/${tag.id}`, { name: 'Refunds', color: '#000000' }, 'PUT');
      expect(await source.getRepository(Tag).findOneByOrFail({ id: tag.id })).toMatchObject({
        name: 'Refunds',
        color: '#000000',
      });

      await form(`/escalated/admin/tags/${tag.id}`, undefined, 'DELETE');
      expect(await source.getRepository(Tag).countBy({ id: tag.id })).toBe(0);
    });
  });

  describe('Escalated/Admin/Workflows', () => {
    beforeEach(async () => {
      await source.getRepository(Workflow).clear();
    });

    it('serves the empty form with the builder options', async () => {
      const result = await page(base, '/escalated/admin/workflows/create', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Workflows/Form');
      expectManifestProps(result);
      expect(result.props.workflow).toBeNull();
      expect(result.props.trigger_events).toEqual(WORKFLOW_TRIGGERS);
      expect(result.props.operators.length).toBeGreaterThan(0);
      expect(result.props.action_types.length).toBeGreaterThan(0);
    });

    it('stores the builder body, lists it, edits, toggles, reorders and deletes', async () => {
      const created = await form('/escalated/admin/workflows', EXAMPLE);
      expect(created.status).toBe(303);
      expect(created.headers.get('location')).toBe('/escalated/admin/workflows');
      const stored = await source.getRepository(Workflow).findOneByOrFail({ name: EXAMPLE.name });

      const index = await page(base, '/escalated/admin/workflows', {
        ...asAdmin,
        headers: { cookie: cookieFrom(created) },
      });
      expect(index.component).toBe('Escalated/Admin/Workflows/Index');
      expectManifestProps(index);
      expect(index.props.flash.success).toBe('Workflow created.');
      expect(index.props.workflows).toEqual([
        expect.objectContaining({
          id: stored.id,
          name: EXAMPLE.name,
          trigger_event: 'ticket.created',
          is_active: true,
        }),
      ]);

      const edit = await page(base, `/escalated/admin/workflows/${stored.id}/edit`, asAdmin);
      expect(edit.component).toBe('Escalated/Admin/Workflows/Form');
      expect(edit.props.workflow).toMatchObject({
        id: stored.id,
        conditions: EXAMPLE.conditions,
        actions: EXAMPLE.actions,
      });

      const updated = await form(
        `/escalated/admin/workflows/${stored.id}`,
        { ...EXAMPLE, name: 'Renamed' },
        'PUT',
      );
      expect(updated.status).toBe(303);
      expect((await source.getRepository(Workflow).findOneByOrFail({ id: stored.id })).name).toBe(
        'Renamed',
      );

      const toggled = await form(`/escalated/admin/workflows/${stored.id}/toggle`, {});
      expect(toggled.status).toBe(303);
      expect(
        (await source.getRepository(Workflow).findOneByOrFail({ id: stored.id })).isActive,
      ).toBe(false);

      const reordered = await form('/escalated/admin/workflows/reorder', {
        workflow_ids: [stored.id],
      });
      expect(reordered.status).toBe(303);

      const removed = await form(`/escalated/admin/workflows/${stored.id}`, undefined, 'DELETE');
      expect(removed.status).toBe(303);
      expect(await source.getRepository(Workflow).countBy({ id: stored.id })).toBe(0);
    });

    it('sends an invalid builder body back with the contract’s field errors', async () => {
      const res = await form(
        '/escalated/admin/workflows',
        { ...EXAMPLE, trigger_event: 'nonsense' },
        'POST',
        '/escalated/admin/workflows/create',
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/workflows/create');
      const next = await page(base, '/escalated/admin/workflows/create', {
        ...asAdmin,
        headers: { cookie: cookieFrom(res) },
      });
      expect(next.props.errors).toHaveProperty('trigger_event');
      expect(await source.getRepository(Workflow).count()).toBe(0);
    });

    it('keeps the JSON workflow API', async () => {
      const res = await apiFetch(base, '/escalated/admin/workflows', { ...asAdmin, body: EXAMPLE });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ name: EXAMPLE.name, trigger: 'ticket.created' });
    });
  });
});
