import { Logger } from '@nestjs/common';
import {
  SCHEDULED_JOBS,
  SCHEDULER_HEARTBEAT_SETTING,
  SchedulerHeartbeatService,
} from '../../src/scheduling/scheduler-heartbeat.service';
import { EscalatedSchedulerService } from '../../src/scheduling/escalated-scheduler.service';
import type { SettingsService } from '../../src/services/settings.service';

/** An in-memory settings store with SettingsService's get/set. */
function memorySettings() {
  const rows = new Map<string, { value: string; type: string; group: string }>();
  return {
    rows,
    get: jest.fn(async (key: string) => rows.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: unknown, type = 'string', group = 'general') => {
      rows.set(key, { value: String(value), type, group });
      return {} as never;
    }),
  };
}

describe('SchedulerHeartbeatService', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('records the heartbeat as an ISO timestamp in the settings table', async () => {
    const settings = memorySettings();
    const heartbeat = new SchedulerHeartbeatService(settings as unknown as SettingsService);

    await heartbeat.record(now);

    expect(settings.rows.get(SCHEDULER_HEARTBEAT_SETTING)).toEqual({
      value: '2026-11-24T12:00:00.000Z',
      type: 'string',
      group: 'system',
    });
  });

  it('is healthy when the heartbeat is at most 15 minutes old', async () => {
    const settings = memorySettings();
    const heartbeat = new SchedulerHeartbeatService(settings as unknown as SettingsService);
    await heartbeat.record(new Date(now.getTime() - 15 * 60 * 1000));

    const status = await heartbeat.status(now);

    expect(status).toEqual({
      healthy: true,
      last_run_at: '2026-11-24T11:45:00.000Z',
      message: 'The recurring jobs are running.',
      commands: SCHEDULED_JOBS,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the heartbeat is missing, naming what to schedule', async () => {
    const heartbeat = new SchedulerHeartbeatService(memorySettings() as unknown as SettingsService);

    const status = await heartbeat.status(now);

    expect(status.healthy).toBe(false);
    expect(status.last_run_at).toBeNull();
    expect(status.message).toContain('recurring jobs are not running');
    expect(status.message).toContain('has never run');
    expect(status.commands).toContainEqual({
      command: 'EscalatedSchedulerService.checkSlaBreaches()',
      interval: 'every minute',
    });
    expect(status.commands.map((job) => job.command)).toEqual(
      expect.arrayContaining([
        'EscalatedSchedulerService.processEscalations()',
        'EscalatedSchedulerService.runAutomations()',
        'EscalatedSchedulerService.unsnoozeTickers()',
      ]),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('EscalatedSchedulerService.checkSlaBreaches()');
  });

  it('warns when the heartbeat is older than 15 minutes, once per stale period', async () => {
    const settings = memorySettings();
    const heartbeat = new SchedulerHeartbeatService(settings as unknown as SettingsService);
    await heartbeat.record(new Date(now.getTime() - 16 * 60 * 1000));

    const status = await heartbeat.status(now);
    await heartbeat.status(new Date(now.getTime() + 60 * 1000));

    expect(status.healthy).toBe(false);
    expect(status.last_run_at).toBe('2026-11-24T11:44:00.000Z');
    expect(status.message).toContain('last ran at 2026-11-24T11:44:00.000Z');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the heartbeat cannot be written', async () => {
    const settings = memorySettings();
    settings.set.mockRejectedValueOnce(new Error('database is down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const heartbeat = new SchedulerHeartbeatService(settings as unknown as SettingsService);

    await expect(heartbeat.record(now)).resolves.toBeUndefined();
    error.mockRestore();
  });
});

describe('EscalatedSchedulerService heartbeat', () => {
  it('stamps the heartbeat each time the SLA check runs, even when the check fails', async () => {
    const sla = {
      checkBreaches: jest.fn(async () => {
        throw new Error('boom');
      }),
      checkWarnings: jest.fn(async () => undefined),
    };
    const heartbeat = { record: jest.fn(async () => undefined) };
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const scheduler = new EscalatedSchedulerService(
      {},
      sla as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      heartbeat as never,
    );

    await scheduler.checkSlaBreaches();

    expect(heartbeat.record).toHaveBeenCalledTimes(1);
    expect(sla.checkWarnings).toHaveBeenCalled();
    error.mockRestore();
  });
});
