import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EscalatedSettings, Ticket, TicketStatus } from '../../src/entities';
import { DataRetentionService } from '../../src/services/data-retention.service';
import { EscalatedSchedulerService } from '../../src/scheduling/escalated-scheduler.service';
import { routeUrl } from '../../src/ui/routes';
import {
  apiFetch,
  bootUi,
  cookieFrom,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The admin Settings sub-pages over real HTTP and SQLite, against
 * escalated-laravel's CsatSettingsController, DataRetentionController,
 * DatabaseConnectionController, EmailSettingsController and
 * PublicTicketsSettingsController. `Admin/Settings/Sandbox` stays unrendered,
 * as in Laravel.
 */
describe('admin settings sub-pages (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let closed: TicketStatus;

  const asAdmin = { as: 'admin' as const };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    const statuses = source.getRepository(TicketStatus);
    const open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
    closed = await statuses.save({ name: 'Closed', slug: 'closed', isClosed: true });
    await source.getRepository(Ticket).save([
      {
        referenceNumber: 'SET-1',
        subject: 'Old',
        description: 'x',
        requesterId: 300,
        statusId: closed.id,
        closedAt: new Date(Date.now() - 6 * 365 * 86_400_000),
      },
      {
        referenceNumber: 'SET-2',
        subject: 'Open',
        description: 'x',
        requesterId: 300,
        statusId: open.id,
      },
    ] as Partial<Ticket>[]);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A form post from `path`, followed to the page it goes back to. */
  const save = async (path: string, body: unknown, method = 'POST') => {
    const res = await inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body,
      headers: { referer: `${base}${path}` },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(path);
    return page(base, path, { ...asAdmin, headers: { cookie: cookieFrom(res) } });
  };

  const stored = async (key: string) =>
    (await source.getRepository(EscalatedSettings).findOneBy({ key }))?.value ?? null;

  it('serves every sub-page to admins only', async () => {
    for (const path of ['csat', 'data-retention', 'database', 'email', 'public-tickets']) {
      const url = `/escalated/admin/settings/${path}`;
      expect((await inertiaFetch(base, url, { as: 'agent' })).status).toBe(403);
      expect((await inertiaFetch(base, url, { as: 'agent', body: {} })).status).toBe(403);
    }
    expect(
      (
        await inertiaFetch(base, '/escalated/admin/settings/database/test', {
          as: 'agent',
          body: { connection: 'default' },
        })
      ).status,
    ).toBe(403);
  });

  it("names the routes as Laravel's", () => {
    expect(routeUrl('escalated.admin.settings.csat.update')).toBe('/escalated/admin/settings/csat');
    expect(routeUrl('escalated.admin.settings.data-retention.update')).toBe(
      '/escalated/admin/settings/data-retention',
    );
    expect(routeUrl('escalated.admin.settings.database.test')).toBe(
      '/escalated/admin/settings/database/test',
    );
    expect(routeUrl('escalated.admin.settings.database.update')).toBe(
      '/escalated/admin/settings/database',
    );
    expect(routeUrl('escalated.admin.settings.email.update')).toBe(
      '/escalated/admin/settings/email',
    );
    expect(routeUrl('escalated.admin.settings.public-tickets.update')).toBe(
      '/escalated/admin/settings/public-tickets',
    );
  });

  describe('Escalated/Admin/Settings/CsatSettings', () => {
    const path = '/escalated/admin/settings/csat';

    it('renders the defaults, saves, and refuses invalid values', async () => {
      const result = await page(base, path, asAdmin);
      expect(result.component).toBe('Escalated/Admin/Settings/CsatSettings');
      expectManifestProps(result);
      expect(result.props.settings).toEqual({
        csat_question_text: 'How would you rate your support experience?',
        csat_scale: '1-5',
        csat_delivery_trigger: 'on_resolve',
        csat_delay_hours: 0,
      });

      const after = await save(path, {
        csat_question_text: 'How did we do?',
        csat_scale: '1-3',
        csat_delivery_trigger: 'delayed',
        csat_delay_hours: 24,
      });
      expect(after.props.flash.success).toBe('CSAT settings updated.');
      expect(after.props.settings.csat_delay_hours).toBe(24);
      expect(await stored('csat_scale')).toBe('1-3');
      expect(await stored('csat_question_text')).toBe('How did we do?');

      const bad = await save(path, {
        csat_question_text: '',
        csat_scale: '1-10',
        csat_delivery_trigger: 'sometimes',
        csat_delay_hours: 169,
      });
      expect(Object.keys(bad.props.errors).sort()).toEqual([
        'csat_delay_hours',
        'csat_delivery_trigger',
        'csat_question_text',
        'csat_scale',
      ]);
      expect(await stored('csat_scale')).toBe('1-3');
    });
  });

  describe('Escalated/Admin/Settings/DataRetention', () => {
    const path = '/escalated/admin/settings/data-retention';

    it('renders the settings and the purge preview, saves, and refuses invalid values', async () => {
      const result = await page(base, path, asAdmin);
      expect(result.component).toBe('Escalated/Admin/Settings/DataRetention');
      expectManifestProps(result);
      expect(result.props.settings).toEqual({
        retention_closed_tickets: 'never',
        retention_attachments: 'never',
        retention_audit_logs: 'never',
        retention_user_data_gdpr: false,
      });
      expect(result.props.purgePreview).toEqual({ tickets: 0, attachments: 0, audit_logs: 0 });

      const after = await save(path, {
        retention_closed_tickets: '5_years',
        retention_attachments: '2_years',
        retention_audit_logs: '90_days',
        retention_user_data_gdpr: true,
      });
      expect(after.props.flash.success).toBe('Data retention settings updated.');
      expect(after.props.settings.retention_user_data_gdpr).toBe(true);
      expect(after.props.purgePreview.tickets).toBe(1);
      expect(await stored('retention_closed_tickets')).toBe('5_years');
      expect(await stored('retention_user_data_gdpr')).toBe('1');

      const bad = await save(path, {
        retention_closed_tickets: '90_days',
        retention_attachments: 'forever',
        retention_audit_logs: '1_year',
      });
      expect(Object.keys(bad.props.errors).sort()).toEqual([
        'retention_attachments',
        'retention_audit_logs',
        'retention_closed_tickets',
        'retention_user_data_gdpr',
      ]);
      expect(await stored('retention_closed_tickets')).toBe('5_years');

      // The daily job applies what the page saved: the old closed ticket goes.
      const scheduler = app.get(EscalatedSchedulerService);
      await scheduler.purgeExpiredData();
      const left = await source.getRepository(Ticket).find({ order: { id: 'ASC' } });
      expect(left.map((t) => t.referenceNumber)).toEqual(['SET-2']);
      expect(app.get(DataRetentionService)).toBeDefined();
    });
  });

  describe('Escalated/Admin/Settings/DatabaseConnection', () => {
    const path = '/escalated/admin/settings/database';

    it('describes the connection read-only and refuses a switch', async () => {
      const result = await page(base, path, asAdmin);
      expect(result.component).toBe('Escalated/Admin/Settings/DatabaseConnection');
      expectManifestProps(result);
      expect(result.props).toMatchObject({
        current: 'default',
        hostDefault: 'default',
        pinnedByConfig: true,
        tablePrefix: 'escalated_',
      });
      expect(result.props.connections).toHaveLength(1);
      const [connection] = result.props.connections;
      expect(Object.keys(connection).sort()).toEqual(
        [
          'database',
          'driver',
          'error',
          'is_current',
          'is_host_default',
          'migrated',
          'name',
          'reachable',
          'ticket_count',
        ].sort(),
      );
      expect(connection).toMatchObject({
        name: 'default',
        driver: 'better-sqlite3',
        is_current: true,
        reachable: true,
        migrated: true,
        error: null,
      });
      expect(typeof connection.ticket_count).toBe('number');

      const refused = await save(path, { connection: 'default' });
      expect(refused.props.flash.error).toMatch(/^The database connection is set in configuration/);

      const tested = await apiFetch(base, `${path}/test`, {
        ...asAdmin,
        body: { connection: 'default' },
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(tested.status).toBe(200);
      expect((await tested.json()).reachable).toBe(true);
      const unknown = await apiFetch(base, `${path}/test`, {
        ...asAdmin,
        body: { connection: 'reporting' },
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(unknown.status).toBe(422);

      const visit = await inertiaFetch(base, `${path}/test`, {
        ...asAdmin,
        body: { connection: 'default' },
        headers: { referer: `${base}${path}` },
      });
      expect(visit.status).toBe(303);
      const flashed = await page(base, path, {
        ...asAdmin,
        headers: { cookie: cookieFrom(visit) },
      });
      expect(flashed.props.flash.success).toBe('Connected to [default].');
    });
  });

  describe('Escalated/Admin/Settings/EmailSettings', () => {
    const path = '/escalated/admin/settings/email';

    it('stores the addresses normalised, keeps an omitted reply address, and validates', async () => {
      const result = await page(base, path, asAdmin);
      expect(result.component).toBe('Escalated/Admin/Settings/EmailSettings');
      expectManifestProps(result);
      expect(result.props.addresses).toEqual([]);
      expect(result.props.defaultReplyAddress).toBe('');

      const after = await save(path, {
        addresses: [
          {
            email: 'support@example.com',
            display_name: 'Support',
            department_id: 3,
            dkim_status: 'verified',
            extra: 'x',
          },
          { email: 'billing@example.com' },
        ],
        default_reply_address: 'support@example.com',
      });
      expect(after.props.flash.success).toBe('Email settings updated.');
      expect(after.props.defaultReplyAddress).toBe('support@example.com');
      expect(after.props.addresses).toEqual([
        {
          email: 'support@example.com',
          display_name: 'Support',
          department_id: 3,
          dkim_status: 'verified',
        },
        {
          email: 'billing@example.com',
          display_name: null,
          department_id: null,
          dkim_status: 'unknown',
        },
      ]);

      await save(path, { addresses: [{ email: 'help@example.com' }] });
      expect(await stored('default_reply_address')).toBe('support@example.com');

      const bad = await save(path, {
        addresses: [{ email: 'not-an-email', dkim_status: 'great' }],
        default_reply_address: 'nope',
      });
      expect(Object.keys(bad.props.errors).sort()).toEqual([
        'addresses.0.dkim_status',
        'addresses.0.email',
        'default_reply_address',
      ]);
      expect(await stored('email_addresses')).toContain('help@example.com');
    });
  });

  describe('Escalated/Admin/Settings/PublicTickets', () => {
    const path = '/escalated/admin/settings/public-tickets';

    it('renders the guest policy, saves over POST and PUT, and validates', async () => {
      const result = await page(base, path, asAdmin);
      expect(result.component).toBe('Escalated/Admin/Settings/PublicTickets');
      expectManifestProps(result);
      expect(result.props.settings).toEqual({
        guest_policy_mode: 'unassigned',
        guest_policy_user_id: null,
        guest_policy_signup_url_template: '',
      });

      const after = await save(path, {
        guest_policy_mode: 'guest_user',
        guest_policy_user_id: '42',
        guest_policy_signup_url_template: 'ignored',
      });
      expect(after.props.flash.success).toBe('Guest policy updated.');
      expect(after.props.settings).toEqual({
        guest_policy_mode: 'guest_user',
        guest_policy_user_id: '42',
        guest_policy_signup_url_template: '',
      });
      expect(JSON.parse((await stored('guest_policy'))!)).toEqual({
        mode: 'guest_user',
        guestUserId: 42,
      });

      const put = await save(
        path,
        {
          guest_policy_mode: 'prompt_signup',
          guest_policy_signup_url_template: 'https://example.com/join',
        },
        'PUT',
      );
      expect(put.props.settings.guest_policy_signup_url_template).toBe('https://example.com/join');
      expect(put.props.settings.guest_policy_user_id).toBeNull();

      const bad = await save(path, {
        guest_policy_mode: 'everyone',
        guest_policy_user_id: '0',
        guest_policy_signup_url_template: 'a'.repeat(501),
      });
      expect(Object.keys(bad.props.errors).sort()).toEqual([
        'guest_policy_mode',
        'guest_policy_signup_url_template',
        'guest_policy_user_id',
      ]);
      expect(JSON.parse((await stored('guest_policy'))!).mode).toBe('prompt_signup');
    });
  });
});
