import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EscalatedSettings } from '../../src/entities';
import { EscalatedSchedulerService } from '../../src/scheduling/escalated-scheduler.service';
import { SCHEDULER_HEARTBEAT_SETTING } from '../../src/scheduling/scheduler-heartbeat.service';
import { apiFetch, bootUi, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * The recurring jobs' heartbeat on the admin screens (`scheduler` on
 * `Escalated/Admin/Settings`, `Escalated/Admin/Reports` and
 * `Escalated/Admin/Reports/Dashboard`) and in the status JSON.
 */
describe('scheduler status for admins', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  const asAdmin = { as: 'admin' as const };

  const screens: [string, string][] = [
    ['/escalated/admin/settings', 'Escalated/Admin/Settings'],
    ['/escalated/admin/reports', 'Escalated/Admin/Reports'],
    ['/escalated/admin/reports/dashboard', 'Escalated/Admin/Reports/Dashboard'],
  ];

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await source.getRepository(EscalatedSettings).delete({ key: SCHEDULER_HEARTBEAT_SETTING });
  });

  it.each(screens)('warns on %s when the heartbeat is missing', async (path, component) => {
    const result = await page(base, path, asAdmin);

    expect(result.component).toBe(component);
    expect(result.props.scheduler).toMatchObject({ healthy: false, last_run_at: null });
    expect(result.props.scheduler.message).toContain('recurring jobs are not running');
    expect(result.props.scheduler.commands).toContainEqual({
      command: 'EscalatedSchedulerService.checkSlaBreaches()',
      interval: 'every minute',
    });
  });

  it.each(screens)('warns on %s when the heartbeat is stale', async (path) => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await source
      .getRepository(EscalatedSettings)
      .save({ key: SCHEDULER_HEARTBEAT_SETTING, value: stale, type: 'string', group: 'system' });

    const result = await page(base, path, asAdmin);

    expect(result.props.scheduler).toMatchObject({ healthy: false, last_run_at: stale });
  });

  it('is healthy once the SLA check has run', async () => {
    await app.get(EscalatedSchedulerService).checkSlaBreaches();

    for (const [path] of screens) {
      const { props } = await page(base, path, asAdmin);
      expect(props.scheduler.healthy).toBe(true);
      expect(Date.now() - Date.parse(props.scheduler.last_run_at)).toBeLessThan(60_000);
    }
  });

  it('sends the same object and the setup check in the status JSON', async () => {
    const res = await apiFetch(base, '/escalated/admin/status', asAdmin);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheduler).toMatchObject({ healthy: false, last_run_at: null });
    expect(body.scheduler.commands.length).toBeGreaterThan(0);
    expect(body.setup).toEqual([]);
  });

  it('keeps the status JSON behind the admin guard', async () => {
    const res = await apiFetch(base, '/escalated/admin/status', { as: 'agent' });
    expect(res.status).toBe(403);
  });
});

describe('guest_tickets_enabled with the guest routes off', () => {
  let app: INestApplication;
  let base: string;

  afterAll(async () => {
    await app?.close();
  });

  it('tells the screens the guest portal is off, and its routes 404', async () => {
    ({ app, base } = await bootUi({ guest: { routesEnabled: false } }));

    const result = await page(base, '/escalated/admin/settings', { as: 'admin' });
    expect(result.component).toBe('Escalated/Admin/Settings');
    expect(result.props.escalated.guest_tickets_enabled).toBe(false);
    expect((await apiFetch(base, '/escalated/guest/create', { as: 'customer' })).status).toBe(
      404,
    );
  });
});
