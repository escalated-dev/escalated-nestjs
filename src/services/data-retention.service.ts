import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, LessThanOrEqual, Not, Repository } from 'typeorm';
import { Attachment } from '../entities/attachment.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { ChatSession } from '../entities/chat-session.entity';
import { CustomFieldValue } from '../entities/custom-field-value.entity';
import { GuestVerification } from '../entities/guest-verification.entity';
import { InboundEmail } from '../entities/inbound-email.entity';
import { Reply } from '../entities/reply.entity';
import { RuleExecution } from '../entities/rule-execution.entity';
import { SatisfactionRating } from '../entities/satisfaction-rating.entity';
import { SideConversationReply } from '../entities/side-conversation-reply.entity';
import { SideConversation } from '../entities/side-conversation.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { TicketFollower } from '../entities/ticket-follower.entity';
import { TicketLink } from '../entities/ticket-link.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { TicketSubjectLink } from '../entities/ticket-subject-link.entity';
import { Ticket } from '../entities/ticket.entity';
import { WorkflowLog } from '../entities/workflow-log.entity';
import { SettingsService } from './settings.service';

/** What one purge run deleted, or on a dry run would delete. */
export interface RetentionReport {
  dryRun: boolean;
  closedTickets: number;
  attachments: number;
  auditLogs: number;
  guestVerifications: number;
}

/** What the periods would purge now: the Data retention page's `purgePreview`. */
export interface RetentionPreview {
  tickets: number;
  attachments: number;
  audit_logs: number;
}

/** escalated-laravel's retention day map; `never` (and anything unknown) is no period. */
const DAYS: Record<string, number> = {
  '90_days': 90,
  '180_days': 180,
  '365_days': 365,
  '1_year': 365,
  '2_years': 730,
  '3_years': 1095,
  '5_years': 1825,
};

const BATCH = 200;

export function retentionDays(setting: string | null | undefined): number | null {
  return setting != null && Object.prototype.hasOwnProperty.call(DAYS, setting)
    ? DAYS[setting]
    : null;
}

/**
 * Applies the data retention settings the admin Data retention page saves
 * (`retention_closed_tickets`, `retention_attachments`, `retention_audit_logs`),
 * as escalated-laravel's `escalated:purge-expired`. Every period defaults to
 * `never`, which purges nothing.
 *
 * Tickets have no soft delete here, so a closed ticket (status `closed`) past
 * its period is deleted outright, with every row that points at it; Laravel's
 * 30-day grace period and `--force` do not apply. Attachment rows past their
 * period are deleted (their files are the host's: the package stores only the
 * path). Expired guest verification codes are deleted. The scheduler runs it
 * daily.
 */
@Injectable()
export class DataRetentionService {
  constructor(
    private readonly settings: SettingsService,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
  ) {}

  private get manager(): EntityManager {
    return this.tickets.manager;
  }

  private async cutoff(key: string, now: Date): Promise<Date | null> {
    const days = retentionDays(await this.settings.get(key, 'never'));
    return days === null ? null : new Date(now.getTime() - days * 86_400_000);
  }

  private async closedStatusIds(manager: EntityManager): Promise<number[]> {
    const rows = await manager.getRepository(TicketStatus).find({ where: { slug: 'closed' } });
    return rows.map((row) => row.id);
  }

  private async expiredTicketIds(
    manager: EntityManager,
    cutoff: Date,
    take?: number,
  ): Promise<number[]> {
    const closed = await this.closedStatusIds(manager);
    if (!closed.length) return [];
    const rows = await manager.getRepository(Ticket).find({
      select: { id: true },
      where: { statusId: In(closed), closedAt: LessThan(cutoff) },
      order: { id: 'ASC' },
      ...(take ? { take } : {}),
    });
    return rows.map((row) => row.id);
  }

  private async countExpiredTickets(manager: EntityManager, cutoff: Date): Promise<number> {
    const closed = await this.closedStatusIds(manager);
    if (!closed.length) return 0;
    return manager.getRepository(Ticket).count({
      where: { statusId: In(closed), closedAt: LessThan(cutoff) },
    });
  }

  /** Never throws: a count it cannot make is 0, as Laravel's page does. */
  async preview(now: Date = new Date()): Promise<RetentionPreview> {
    const preview: RetentionPreview = { tickets: 0, attachments: 0, audit_logs: 0 };
    try {
      const ticketCutoff = await this.cutoff('retention_closed_tickets', now);
      if (ticketCutoff)
        preview.tickets = await this.countExpiredTickets(this.manager, ticketCutoff);
      const attachmentCutoff = await this.cutoff('retention_attachments', now);
      if (attachmentCutoff) {
        preview.attachments = await this.manager
          .getRepository(Attachment)
          .count({ where: { createdAt: LessThan(attachmentCutoff) } });
      }
      const auditCutoff = await this.cutoff('retention_audit_logs', now);
      if (auditCutoff) {
        preview.audit_logs = await this.manager
          .getRepository(AuditLog)
          .count({ where: { createdAt: LessThan(auditCutoff) } });
      }
    } catch {
      return { tickets: 0, attachments: 0, audit_logs: 0 };
    }
    return preview;
  }

  /** Runs the purge as of `now`. With `dryRun` it only counts. */
  async purgeExpired(options: { dryRun?: boolean; now?: Date } = {}): Promise<RetentionReport> {
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? new Date();

    let closedTickets = 0;
    const ticketCutoff = await this.cutoff('retention_closed_tickets', now);
    if (ticketCutoff) {
      closedTickets = await this.countExpiredTickets(this.manager, ticketCutoff);
      if (!dryRun && closedTickets > 0) {
        for (;;) {
          const ids = await this.expiredTicketIds(this.manager, ticketCutoff, BATCH);
          if (!ids.length) break;
          await this.manager.transaction((manager) => this.deleteTickets(manager, ids));
        }
      }
    }

    const attachments = await this.purgeBefore(Attachment, 'retention_attachments', now, dryRun);
    const auditLogs = await this.purgeBefore(AuditLog, 'retention_audit_logs', now, dryRun);

    const codes = this.manager.getRepository(GuestVerification);
    const expired = { expiresAt: LessThanOrEqual(now) };
    const guestVerifications = await codes.count({ where: expired });
    if (!dryRun && guestVerifications > 0) await codes.delete(expired);

    return { dryRun, closedTickets, attachments, auditLogs, guestVerifications };
  }

  private async purgeBefore(
    entity: typeof Attachment | typeof AuditLog,
    key: string,
    now: Date,
    dryRun: boolean,
  ): Promise<number> {
    const cutoff = await this.cutoff(key, now);
    if (!cutoff) return 0;
    const repo = this.manager.getRepository<Attachment | AuditLog>(entity);
    const where = { createdAt: LessThan(cutoff) };
    const count = await repo.count({ where });
    if (!dryRun && count > 0) await repo.delete(where);
    return count;
  }

  /**
   * Deletes the tickets and every row that points at them, children first
   * (SQLite enforces the foreign keys, and some have no cascade). Tickets merged
   * into one of them are kept and unlinked; inbound emails keep their record
   * without the ticket.
   */
  private async deleteTickets(manager: EntityManager, ids: number[]): Promise<void> {
    const replyIds = (
      await manager
        .getRepository(Reply)
        .find({ select: { id: true }, where: { ticketId: In(ids) } })
    ).map((reply) => reply.id);
    const sideConversationIds = (
      await manager
        .getRepository(SideConversation)
        .find({ select: { id: true }, where: { ticketId: In(ids) } })
    ).map((conversation) => conversation.id);

    await manager.getRepository(Attachment).delete({ ticketId: In(ids) });
    if (replyIds.length) await manager.getRepository(Attachment).delete({ replyId: In(replyIds) });
    if (sideConversationIds.length) {
      await manager
        .getRepository(SideConversationReply)
        .delete({ sideConversationId: In(sideConversationIds) });
    }
    await manager.getRepository(SideConversation).delete({ ticketId: In(ids) });
    await manager.getRepository(ChatSession).delete({ ticketId: In(ids) });
    await manager.getRepository(RuleExecution).delete({ ticketId: In(ids) });
    await manager.getRepository(SatisfactionRating).delete({ ticketId: In(ids) });
    await manager.getRepository(TicketActivity).delete({ ticketId: In(ids) });
    await manager.getRepository(TicketFollower).delete({ ticketId: In(ids) });
    await manager.getRepository(TicketSubjectLink).delete({ ticketId: In(ids) });
    await manager.getRepository(TicketLink).delete({ ticketId: In(ids) });
    await manager.getRepository(TicketLink).delete({ linkedTicketId: In(ids) });
    await manager
      .getRepository(CustomFieldValue)
      .delete({ entityType: 'ticket', entityId: In(ids) });
    await manager
      .createQueryBuilder()
      .delete()
      .from(WorkflowLog)
      .where('ticket_id IN (:...ids)', { ids })
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from('escalated_ticket_tags')
      .where(`${manager.connection.driver.escape('ticketId')} IN (:...ids)`, { ids })
      .execute();
    await manager.getRepository(Reply).delete({ ticketId: In(ids) });
    await manager
      .getRepository(InboundEmail)
      .update({ matchedTicketId: In(ids) }, { matchedTicketId: null });
    await manager
      .getRepository(InboundEmail)
      .update({ createdTicketId: In(ids) }, { createdTicketId: null });
    await manager.getRepository(Ticket).update({ mergedIntoTicketId: In(ids), id: Not(In(ids)) }, {
      mergedIntoTicketId: null,
    } as never);
    await manager.getRepository(Ticket).delete({ id: In(ids) });
  }
}
