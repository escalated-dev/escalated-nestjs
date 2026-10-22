import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { Tag } from '../entities/tag.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { Reply } from '../entities/reply.entity';
import { TicketFollower } from '../entities/ticket-follower.entity';
import { resolveFollowerUserIds } from './follower-recipients';
import { findStatusBySlugOrId } from './status-lookup';
import { TicketService } from './ticket.service';
import {
  ESCALATED_EVENTS,
  TicketAssignedEvent,
  TicketDepartmentChangedEvent,
  TicketPriorityChangedEvent,
  TicketStatusChangedEvent,
  TicketTagAddedEvent,
  TicketTagRemovedEvent,
} from '../events/escalated.events';
import { lifecycleEvent } from '../events/ticket-lifecycle';
import { WorkflowEngineService } from './workflow-engine.service';
import { UserId } from '../config/user-id-column';

export interface WorkflowAction {
  type: string;
  value?: string;
}

/**
 * Performs the side-effects dictated by a matched Workflow. Distinct from
 * WorkflowEngineService (which only evaluates conditions).
 *
 * Action catalog: change_priority, add_tag, remove_tag, change_status,
 * set_department, assign_agent, add_note, insert_canned_reply,
 * add_follower. Additional actions (send_webhook, delay,
 * assign_round_robin) are scheduled for a follow-up.
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
    @InjectRepository(TicketFollower)
    private readonly followerRepo: Repository<TicketFollower>,
    private readonly eventEmitter: EventEmitter2,
    private readonly engine: WorkflowEngineService,
    @Optional() private readonly tickets?: TicketService,
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
      case 'insert_canned_reply':
        return this.insertCannedReply(ticket, action.value ?? '');
      case 'add_follower':
        return this.addFollower(ticket, action.value ?? '');
      default:
        throw new Error(`Unknown workflow action: ${action.type}`);
    }
  }

  private async changePriority(ticket: Ticket, priority: string): Promise<void> {
    const previous = ticket.priority;
    await this.ticketRepo.update(ticket.id, { priority });
    if (previous === priority) return;
    ticket.priority = priority;
    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_PRIORITY_CHANGED,
      new TicketPriorityChangedEvent({ ...ticket }, previous, priority, 0),
    );
  }

  private async setDepartment(ticket: Ticket, value: string): Promise<void> {
    const departmentId = Number(value);
    if (!Number.isFinite(departmentId)) return;
    const previous = ticket.departmentId ?? null;
    await this.ticketRepo.update(ticket.id, { departmentId });
    if (previous === departmentId) return;
    ticket.departmentId = departmentId;
    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_DEPARTMENT_CHANGED,
      new TicketDepartmentChangedEvent({ ...ticket }, previous, departmentId, 0),
    );
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
        relations: { tags: true },
      })) ?? ticket;
    const tags = fresh.tags ?? [];
    if (!tags.some((t) => t.id === tag.id)) {
      tags.push(tag);
      fresh.tags = tags;
      await this.ticketRepo.save(fresh);
      this.eventEmitter.emit(
        ESCALATED_EVENTS.TICKET_TAG_ADDED,
        new TicketTagAddedEvent(fresh, { id: tag.id, name: tag.name, slug: tag.slug }, 0),
      );
    }
  }

  private async removeTag(ticket: Ticket, value: string): Promise<void> {
    const tag = await this.resolveTag(value);
    if (!tag) return;
    const fresh =
      (await this.ticketRepo.findOne({
        where: { id: ticket.id },
        relations: { tags: true },
      })) ?? ticket;
    const before = fresh.tags ?? [];
    if (!before.some((t) => t.id === tag.id)) return;
    fresh.tags = before.filter((t) => t.id !== tag.id);
    await this.ticketRepo.save(fresh);
    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_TAG_REMOVED,
      new TicketTagRemovedEvent(fresh, { id: tag.id, name: tag.name, slug: tag.slug }, 0),
    );
  }

  /** The builder sends the tag name; a slug or id also works. */
  private async resolveTag(value: string): Promise<Tag | null> {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const nameHit = await this.tagRepo.findOne({ where: { name: trimmed } });
    if (nameHit) return nameHit;
    value = trimmed;
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
    const status = await findStatusBySlugOrId(this.statusRepo, value);
    if (!status) {
      this.logger.debug(`change_status: status "${value}" not found`);
      return;
    }
    const previousStatusId = ticket.statusId;
    if (previousStatusId === status.id) return;
    if (this.tickets) {
      // The normal status-change path: a solved status stamps resolvedAt (which
      // stops SLA), and the status and lifecycle events go out from there.
      await this.tickets.update(ticket.id, { statusId: status.id }, 0);
      return;
    }
    const previousStatus =
      ticket.status ??
      (previousStatusId != null
        ? await this.statusRepo.findOne({ where: { id: previousStatusId } })
        : null);
    await this.ticketRepo.update(ticket.id, { statusId: status.id });
    const followerUserIds = await resolveFollowerUserIds(this.followerRepo, ticket.id, 0);
    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_STATUS_CHANGED,
      new TicketStatusChangedEvent(
        { ...ticket, statusId: status.id },
        previousStatusId,
        status.id,
        0,
        followerUserIds,
      ),
    );
    const lifecycle = lifecycleEvent(previousStatus, status, { ...ticket, statusId: status.id }, 0);
    if (lifecycle) this.eventEmitter.emit(lifecycle[0], lifecycle[1]);
  }

  private async assignAgent(ticket: Ticket, value: string): Promise<void> {
    const assigneeId: UserId = value.trim();
    if (!assigneeId || assigneeId === '0') return;
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

  /**
   * Add a host-app user as a follower on the ticket. Idempotent: if the
   * user is already following, this is a no-op. The value is a host user
   * key, treated the same way as assign_agent — trimmed and stored as-is
   * so uuid/string-keyed hosts work alongside integer-keyed ones. Skips
   * silently on an empty / "0" value.
   */
  private async addFollower(ticket: Ticket, value: string): Promise<void> {
    const userId: UserId = (value ?? '').trim();
    if (!userId || userId === '0') {
      this.logger.warn(`add_follower: invalid user id "${value}" — skipping`);
      return;
    }

    const existing = await this.followerRepo.findOne({
      where: { ticketId: ticket.id, userId },
    });
    if (existing) return;

    await this.followerRepo.save({ ticketId: ticket.id, userId });
  }
}
