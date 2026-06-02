import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { Newsletter } from '../entities/newsletter';
import { SlaService } from '../services/sla.service';
import { EscalationService } from '../services/escalation.service';
import { WebhookService } from '../services/webhook.service';
import { ChatSessionService } from '../services/chat-session.service';
import { AutomationService } from '../services/automation.service';
import { NewsletterDispatcherService } from '../services/newsletter/newsletter-dispatcher.service';
import { NewsletterPlannerService } from '../services/newsletter/newsletter-planner.service';
import { Ticket } from '../entities/ticket.entity';

@Injectable()
export class EscalatedSchedulerService {
  private readonly logger = new Logger(EscalatedSchedulerService.name);
  private newsletterTickRunning = false;

  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
    private readonly slaService: SlaService,
    private readonly escalationService: EscalationService,
    private readonly webhookService: WebhookService,
    private readonly chatSessionService: ChatSessionService,
    private readonly automationService: AutomationService,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @Optional()
    private readonly newsletterPlanner?: NewsletterPlannerService,
    @Optional()
    private readonly newsletterDispatcher?: NewsletterDispatcherService,
    @Optional()
    @InjectRepository(Newsletter)
    private readonly newsletterRepo?: Repository<Newsletter>,
  ) {}

  /** Check for SLA breaches every minute */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkSlaBreaches(): Promise<void> {
    try {
      await this.slaService.checkBreaches();
    } catch (error) {
      this.logger.error('Error checking SLA breaches', error);
    }
  }

  /** Process escalation rules every 5 minutes */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processEscalations(): Promise<void> {
    try {
      await this.escalationService.processEscalations();
    } catch (error) {
      this.logger.error('Error processing escalations', error);
    }
  }

  /** Auto-unsnooze tickets every minute */
  @Cron(CronExpression.EVERY_MINUTE)
  async unsnoozeTickers(): Promise<void> {
    try {
      const now = new Date();
      const snoozedTickets = await this.ticketRepo.find({
        where: {
          snoozedUntil: LessThanOrEqual(now),
          isMerged: false,
        },
      });

      for (const ticket of snoozedTickets) {
        await this.ticketRepo.update(ticket.id, { snoozedUntil: null as any });
        this.logger.log(`Unsnoozed ticket #${ticket.referenceNumber}`);
      }
    } catch (error) {
      this.logger.error('Error unsnoozing tickets', error);
    }
  }

  /** Retry failed webhook deliveries every 5 minutes */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryWebhooks(): Promise<void> {
    try {
      await this.webhookService.retryFailedDeliveries(3);
    } catch (error) {
      this.logger.error('Error retrying webhook deliveries', error);
    }
  }

  /** Clean up idle chat sessions every minute */
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupIdleChatSessions(): Promise<void> {
    try {
      await this.chatSessionService.cleanupIdleSessions(30);
    } catch (error) {
      this.logger.error('Error cleaning up idle chat sessions', error);
    }
  }

  /** Run all active time-based automations every 5 minutes */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAutomations(): Promise<void> {
    try {
      const affected = await this.automationService.run();
      if (affected > 0) {
        this.logger.log(`Automations applied actions to ${affected} ticket(s)`);
      }
    } catch (error) {
      this.logger.error('Error running automations', error);
    }
  }

  /** Plan due newsletters and dispatch one batch every minute. */
  @Cron(CronExpression.EVERY_MINUTE)
  async runNewsletters(): Promise<void> {
    if (!this.options.enableNewsletters) return;
    if (!this.newsletterPlanner || !this.newsletterDispatcher || !this.newsletterRepo) return;
    if (this.newsletterTickRunning) {
      this.logger.warn('Previous newsletter dispatch tick is still running; skipping');
      return;
    }

    this.newsletterTickRunning = true;
    try {
      const due = await this.newsletterRepo.find({
        where: { status: 'scheduled', scheduled_at: LessThanOrEqual(new Date()) },
      });
      for (const newsletter of due) {
        await this.newsletterPlanner.plan(newsletter);
      }
      await this.newsletterDispatcher.dispatchBatch();
    } catch (error) {
      this.logger.error('Error dispatching newsletters', error);
    } finally {
      this.newsletterTickRunning = false;
    }
  }
}
