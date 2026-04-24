import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { Tag } from '../entities/tag.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { Reply } from '../entities/reply.entity';
import { DeferredWorkflowJob } from '../entities/deferred-workflow-job.entity';
import {
  ESCALATED_EVENTS,
  TicketAssignedEvent,
  TicketStatusChangedEvent,
} from '../events/escalated.events';
import { WorkflowEngineService } from './workflow-engine.service';

export interface WorkflowAction {
  type: string;
  value?: string;
}

/**
 * Performs the side-effects dictated by a matched Workflow. Distinct from
 * WorkflowEngineService (which only evaluates conditions).
 *
 * Action catalog: change_priority, add_tag, remove_tag, change_status,
 * set_department, assign_agent, add_note, insert_canned_reply, delay.
 *
 * `delay` splits a run into two halves: everything before the delay runs
 * inline, everything after is persisted as a DeferredWorkflowJob and
 * picked up by {@link runDueDeferredJobs} once the wait expires.
 */
@Injectable()
export class WorkflowExecutorService {
  private readonly logger = new Logger(WorkflowExecutorService.name);

  constructor(
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(TicketStatus) private readonly statusRepo: Repository<TicketStatus>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(TicketActivity) private readonly activityRepo: Repository<TicketActivity>,
    @InjectRepository(Reply) private readonly replyRepo: Repository<Reply>,
    @InjectRepository(DeferredWorkflowJob)
    private readonly deferredRepo: Repository<DeferredWorkflowJob>,
    private readonly eventEmitter: EventEmitter2,
    private readonly engine: WorkflowEngineService,
  ) {}

  async execute(ticket: Ticket, actions: WorkflowAction[]): Promise<void> {
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.type === 'delay') {
        const remaining = actions.slice(i + 1);
        await this.scheduleDelay(ticket, action.value ?? '', remaining);
        return;
      }
      await this.dispatch(ticket, action);
    }
  }

  private async dispatch(ticket: Ticket, action: WorkflowAction): Promise<void> {
    switch (action.type) {
      case 'change_priority':
        return this.changePriority(ticket, action.value ?? 'medium');
      case 'add_tag':
        return this.addTag(ticket, action.value ?? '');
      case 'remove_tag':
        return this.removeTag(ticket, action.value ?? '');
      case 'change_status':
        return this.changeStatus(ticket, action.value ?? '');
      case 'set_department':
        return this.setDepartment(ticket, action.value ?? '');
      case 'assign_agent':
        return this.assignAgent(ticket, action.value ?? '');
      case 'add_note':
        return this.addNote(ticket, action.value ?? '');
      case 'insert_canned_reply':
        return this.insertCannedReply(ticket, action.value ?? '');
      default:
        throw new Error(`Unknown workflow action: ${action.type}`);
    }
  }

  private async changePriority(ticket: Ticket, priority: string): Promise<void> {
    await this.ticketRepo.update(ticket.id, { priority });
  }

  private async setDepartment(ticket: Ticket, value: string): Promise<void> {
    const departmentId = Number(value);
    if (!Number.isFinite(departmentId)) return;
    await this.ticketRepo.update(ticket.id, { departmentId });
  }

  private async addTag(ticket: Ticket, value: string): Promise<void> {
    const tag = await this.resolveTag(value);
    if (!tag) {
      this.logger.debug(`add_tag: tag "${value}" not found`);
      return;
    }
    const fresh =
      (await this.ticketRepo.findOne({
        where: { id: ticket.id },
        relations: ['tags'],
      })) ?? ticket;
    const tags = fresh.tags ?? [];
    if (!tags.some((t) => t.id === tag.id)) {
      tags.push(tag);
      fresh.tags = tags;
      await this.ticketRepo.save(fresh);
    }
  }

  private async removeTag(ticket: Ticket, value: string): Promise<void> {
    const tag = await this.resolveTag(value);
    if (!tag) return;
    const fresh =
      (await this.ticketRepo.findOne({
        where: { id: ticket.id },
        relations: ['tags'],
      })) ?? ticket;
    fresh.tags = (fresh.tags ?? []).filter((t) => t.id !== tag.id);
    await this.ticketRepo.save(fresh);
  }

  private async resolveTag(value: string): Promise<Tag | null> {
    const slugHit = await this.tagRepo.findOne({ where: { slug: value } });
    if (slugHit) return slugHit;
    const asId = Number(value);
    if (Number.isFinite(asId) && asId > 0) {
      const idHit = await this.tagRepo.findOne({ where: { id: asId } });
      if (idHit) return idHit;
    }
    return null;
  }

  private async changeStatus(ticket: Ticket, value: string): Promise<void> {
    let status = await this.statusRepo.findOne({ where: { slug: value } });
    if (!status) {
      const asId = Number(value);
      if (Number.isFinite(asId) && asId > 0) {
        status = await this.statusRepo.findOne({ where: { id: asId } });
      }
    }
    if (!status) {
      this.logger.debug(`change_status: status "${value}" not found`);
      return;
    }
    const previousStatusId = ticket.statusId;
    await this.ticketRepo.update(ticket.id, { statusId: status.id });
    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_STATUS_CHANGED,
      new TicketStatusChangedEvent(
        { ...ticket, statusId: status.id },
        previousStatusId,
        status.id,
        0,
      ),
    );
  }

  private async assignAgent(ticket: Ticket, value: string): Promise<void> {
    const assigneeId = Number(value);
    if (!Number.isFinite(assigneeId) || assigneeId <= 0) return;
    const previousAssigneeId = ticket.assigneeId ?? null;
    await this.ticketRepo.update(ticket.id, { assigneeId });
    await this.activityRepo.save({
      ticketId: ticket.id,
      userId: 0,
      action: 'assigned',
      description: `Workflow assigned ticket to agent #${assigneeId}`,
    });
    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_ASSIGNED,
      new TicketAssignedEvent({ ...ticket, assigneeId }, previousAssigneeId, assigneeId, 0),
    );
  }

  private async addNote(ticket: Ticket, body: string): Promise<void> {
    if (!body) return;
    await this.replyRepo.save({
      ticketId: ticket.id,
      userId: 0,
      body,
      type: 'note',
      isInternal: true,
    });
  }

  /**
   * Insert an external-visible reply built from a template. `{{field}}`
   * placeholders are interpolated against the ticket via
   * WorkflowEngineService.interpolateVariables. Unknown variables stay as
   * literal `{{...}}` so the reader can see the gap.
   */
  private async insertCannedReply(ticket: Ticket, template: string): Promise<void> {
    if (!template) return;
    const ticketMap: Record<string, string> = {};
    const raw = ticket as unknown as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      const v = raw[key];
      if (v === null || v === undefined) continue;
      if (typeof v === 'object') continue;
      ticketMap[key] = String(v);
    }
    const body = this.engine.interpolateVariables(template, ticketMap);
    await this.replyRepo.save({
      ticketId: ticket.id,
      userId: 0,
      body,
      type: 'reply',
      isInternal: false,
    });
  }

  private async scheduleDelay(
    ticket: Ticket,
    value: string,
    remainingActions: WorkflowAction[],
  ): Promise<void> {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.logger.warn(`delay: invalid seconds value "${value}", skipping remaining actions`);
      return;
    }
    const runAt = new Date(Date.now() + seconds * 1000);
    await this.deferredRepo.save({
      ticketId: ticket.id,
      remainingActions,
      runAt,
      status: 'pending',
    });
  }

  /**
   * Poll for deferred jobs whose wait has elapsed and resume their
   * remainingActions. Flips status to `done` on success, `failed` (with
   * lastError populated) on exception, so rows are audit-retained and
   * never re-picked up.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runDueDeferredJobs(): Promise<void> {
    let dueJobs: DeferredWorkflowJob[];
    try {
      dueJobs = await this.deferredRepo.find({
        where: { status: 'pending', runAt: LessThanOrEqual(new Date()) },
      });
    } catch (error) {
      this.logger.error('Error querying deferred workflow jobs', error as Error);
      return;
    }
    for (const job of dueJobs) {
      try {
        const ticket = await this.ticketRepo.findOne({ where: { id: job.ticketId } });
        if (!ticket) {
          await this.deferredRepo.update(job.id, {
            status: 'failed',
            lastError: `Ticket #${job.ticketId} not found`,
          });
          continue;
        }
        await this.execute(ticket, job.remainingActions as WorkflowAction[]);
        await this.deferredRepo.update(job.id, { status: 'done' });
      } catch (error) {
        this.logger.error(`Deferred job #${job.id} failed`, error as Error);
        await this.deferredRepo.update(job.id, {
          status: 'failed',
          lastError: (error as Error)?.message ?? 'unknown error',
        });
      }
    }
  }
}
