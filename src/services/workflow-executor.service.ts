import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { Tag } from '../entities/tag.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { Reply } from '../entities/reply.entity';
import {
  ESCALATED_EVENTS,
  TicketAssignedEvent,
  TicketStatusChangedEvent,
} from '../events/escalated.events';

export interface WorkflowAction {
  type: string;
  value?: string;
}

/**
 * Performs the side-effects dictated by a matched Workflow. Distinct from
 * WorkflowEngineService (which only evaluates conditions).
 *
 * Action catalog (this commit): change_priority, add_tag, remove_tag,
 * change_status, set_department, assign_agent, add_note. Additional actions
 * (send_webhook, add_follower, delay, assign_round_robin) are scheduled for
 * a follow-up.
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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(ticket: Ticket, actions: WorkflowAction[]): Promise<void> {
    for (const action of actions) {
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
    const fresh = (await this.ticketRepo.findOne({
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
    const fresh = (await this.ticketRepo.findOne({
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
      new TicketAssignedEvent(
        { ...ticket, assigneeId },
        previousAssigneeId,
        assigneeId,
        0,
      ),
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
}
