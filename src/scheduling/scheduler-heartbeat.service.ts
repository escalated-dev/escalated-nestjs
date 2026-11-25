import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../services/settings.service';

/** The settings row the SLA check stamps each time it runs. */
export const SCHEDULER_HEARTBEAT_SETTING = 'scheduler_heartbeat_at';

/** A heartbeat older than this means the recurring jobs are not running. */
export const SCHEDULER_STALE_AFTER_MINUTES = 15;

/**
 * The recurring jobs, as `EscalatedSchedulerService` runs them in-process with
 * `@nestjs/schedule`. A host whose process does not stay up to run cron jobs
 * (serverless, or a worker that does not import EscalatedModule) calls these
 * methods from its own scheduler at these intervals.
 */
export const SCHEDULED_JOBS: { command: string; interval: string }[] = [
  { command: 'EscalatedSchedulerService.checkSlaBreaches()', interval: 'every minute' },
  { command: 'EscalatedSchedulerService.unsnoozeTickers()', interval: 'every minute' },
  { command: 'EscalatedSchedulerService.processEscalations()', interval: 'every 5 minutes' },
  { command: 'EscalatedSchedulerService.runAutomations()', interval: 'every 5 minutes' },
  { command: 'EscalatedSchedulerService.retryWebhooks()', interval: 'every 5 minutes' },
  { command: 'EscalatedSchedulerService.cleanupIdleChatSessions()', interval: 'every minute' },
  { command: 'EscalatedSchedulerService.runPluginCron()', interval: 'every minute' },
  { command: 'EscalatedSchedulerService.purgeExpiredData()', interval: 'daily at 03:30' },
];

/** What the admin screens and the status JSON show about the recurring jobs. */
export interface SchedulerStatus {
  healthy: boolean;
  last_run_at: string | null;
  message: string;
  commands: { command: string; interval: string }[];
}

/**
 * Records when the SLA check last ran, and tells admins when the recurring
 * jobs (SLA checks, escalation rules, automations, snooze wake-ups) have
 * stopped: no heartbeat, or one older than 15 minutes.
 */
@Injectable()
export class SchedulerHeartbeatService {
  private readonly logger = new Logger('EscalatedScheduler');
  private lastWarnedAt = 0;

  constructor(private readonly settings: SettingsService) {}

  /** Stamps the heartbeat. Never throws: a failed write must not stop the job. */
  async record(now: Date = new Date()): Promise<void> {
    try {
      await this.settings.set(SCHEDULER_HEARTBEAT_SETTING, now.toISOString(), 'string', 'system');
    } catch (error) {
      this.logger.error('Could not record the scheduler heartbeat', error as Error);
    }
  }

  async lastRunAt(): Promise<Date | null> {
    const value = await this.settings.get(SCHEDULER_HEARTBEAT_SETTING);
    if (!value) return null;
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
  }

  /**
   * The scheduler's health. An unhealthy answer is also logged as a warning,
   * at most once per stale period.
   */
  async status(now: Date = new Date()): Promise<SchedulerStatus> {
    const last = await this.lastRunAt();
    const staleMs = SCHEDULER_STALE_AFTER_MINUTES * 60 * 1000;
    const healthy = last !== null && now.getTime() - last.getTime() <= staleMs;
    const message = healthy
      ? 'The recurring jobs are running.'
      : `Escalated's recurring jobs are not running: ${
          last
            ? `the SLA check last ran at ${last.toISOString()}, over ${SCHEDULER_STALE_AFTER_MINUTES} minutes ago`
            : 'the SLA check has never run'
        }. SLA breaches, escalation rules, automations and snooze wake-ups wait until they run. ` +
        'EscalatedModule runs them with @nestjs/schedule in a process that stays up; ' +
        'if yours does not (serverless, or a separate worker), call these from your scheduler.';

    if (!healthy && now.getTime() - this.lastWarnedAt >= staleMs) {
      this.lastWarnedAt = now.getTime();
      this.logger.warn(
        `${message} ${SCHEDULED_JOBS.map((job) => `${job.command} ${job.interval}`).join('; ')}`,
      );
    }

    return {
      healthy,
      last_run_at: last ? last.toISOString() : null,
      message,
      commands: SCHEDULED_JOBS.map((job) => ({ ...job })),
    };
  }
}
