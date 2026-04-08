import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { SlaService } from '../services/sla.service';
import { EscalationService } from '../services/escalation.service';
import { WebhookService } from '../services/webhook.service';
import { ChatSessionService } from '../services/chat-session.service';
import { Ticket } from '../entities/ticket.entity';

@Injectable()
export class EscalatedSchedulerService {
  private readonly logger = new Logger(EscalatedSchedulerService.name);

  constructor(
    private readonly slaService: SlaService,
    private readonly escalationService: EscalationService,
    private readonly webhookService: WebhookService,
    private readonly chatSessionService: ChatSessionService,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
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
}
