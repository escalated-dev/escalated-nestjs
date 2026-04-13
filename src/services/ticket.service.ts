import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { TicketLink } from '../entities/ticket-link.entity';
import { Reply } from '../entities/reply.entity';
import { AgentProfile } from '../entities/agent-profile.entity';
import { ChatSession } from '../entities/chat-session.entity';
import { Tag } from '../entities/tag.entity';
import { CustomFieldValue } from '../entities/custom-field-value.entity';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { UpdateTicketDto } from '../dto/update-ticket.dto';
import { TicketFilterDto } from '../dto/ticket-filter.dto';
import {
  ESCALATED_EVENTS,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketAssignedEvent,
  TicketStatusChangedEvent,
  TicketMergedEvent,
  TicketSplitEvent,
} from '../events/escalated.events';

@Injectable()
export class TicketService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(TicketStatus)
    private readonly statusRepo: Repository<TicketStatus>,
    @InjectRepository(TicketActivity)
    private readonly activityRepo: Repository<TicketActivity>,
    @InjectRepository(Reply)
    private readonly replyRepo: Repository<Reply>,
    @InjectRepository(AgentProfile)
    private readonly agentProfileRepo: Repository<AgentProfile>,
    @InjectRepository(ChatSession)
    private readonly chatSessionRepo: Repository<ChatSession>,
    @InjectRepository(TicketLink)
    private readonly ticketLinkRepo: Repository<TicketLink>,
    @InjectRepository(Tag)
    private readonly tagRepo: Repository<Tag>,
    @InjectRepository(CustomFieldValue)
    private readonly customFieldValueRepo: Repository<CustomFieldValue>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private generateReferenceNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TK-${timestamp}${random}`;
  }

  /**
   * Populate computed fields (requester_name, requester_email, last_reply_at,
   * last_reply_author) that cannot be derived inside an @AfterLoad hook because
   * they require additional queries.
   */
  private async enrichTickets(tickets: Ticket[]): Promise<Ticket[]> {
    if (tickets.length === 0) return tickets;

    const ticketIds = tickets.map((t) => t.id);

    // --- last reply per ticket (most recent non-internal reply) -----------
    const lastReplies: { ticketId: number; createdAt: Date; userId: number }[] =
      await this.replyRepo
        .createQueryBuilder('reply')
        .select('reply.ticketId', 'ticketId')
        .addSelect('MAX(reply.createdAt)', 'createdAt')
        .where('reply.ticketId IN (:...ticketIds)', { ticketIds })
        .andWhere('reply.isInternal = :isInternal', { isInternal: false })
        .groupBy('reply.ticketId')
        .getRawMany();

    // For author name we need the actual reply row so we can look up the user
    const lastReplyMap = new Map<number, { createdAt: Date; userId: number }>();
    if (lastReplies.length > 0) {
      // Fetch the actual reply rows for the max timestamps
      for (const lr of lastReplies) {
        const reply = await this.replyRepo.findOne({
          where: { ticketId: lr.ticketId, isInternal: false },
          order: { createdAt: 'DESC' },
          select: ['id', 'ticketId', 'userId', 'createdAt'],
        });
        if (reply) {
          lastReplyMap.set(reply.ticketId, {
            createdAt: reply.createdAt,
            userId: reply.userId,
          });
        }
      }
    }

    // --- collect unique user IDs we need to resolve ---------------------
    const userIds = new Set<number>();
    for (const t of tickets) {
      userIds.add(t.requesterId);
    }
    for (const lr of lastReplyMap.values()) {
      userIds.add(lr.userId);
    }

    // Build a userId -> { name, email } lookup from AgentProfile
    const agentProfiles = await this.agentProfileRepo.find({
      where: { userId: In([...userIds]) },
      select: ['userId', 'displayName'],
    });
    const profileMap = new Map<number, AgentProfile>();
    for (const p of agentProfiles) {
      profileMap.set(p.userId, p);
    }

    // --- chat sessions for visitor info (requester on chat tickets) ------
    const chatTicketIds = tickets.filter((t) => t.channel === 'chat').map((t) => t.id);
    const chatSessionMap = new Map<number, ChatSession>();
    if (chatTicketIds.length > 0) {
      const sessions = await this.chatSessionRepo.find({
        where: { ticketId: In(chatTicketIds) },
        select: ['ticketId', 'visitorName', 'visitorEmail'],
      });
      for (const s of sessions) {
        chatSessionMap.set(s.ticketId, s);
      }
    }

    // --- assign computed fields -----------------------------------------
    for (const ticket of tickets) {
      // requester_name / requester_email
      const chatSession = chatSessionMap.get(ticket.id);
      const agentProfile = profileMap.get(ticket.requesterId);
      ticket.requester_name =
        chatSession?.visitorName || agentProfile?.displayName || `User #${ticket.requesterId}`;
      ticket.requester_email = chatSession?.visitorEmail || undefined;

      // last_reply_at / last_reply_author
      const lr = lastReplyMap.get(ticket.id);
      if (lr) {
        ticket.last_reply_at = lr.createdAt;
        const authorProfile = profileMap.get(lr.userId);
        ticket.last_reply_author = authorProfile?.displayName || `User #${lr.userId}`;
      }
    }

    return tickets;
  }

  private async enrichTicket(ticket: Ticket): Promise<Ticket> {
    const [enriched] = await this.enrichTickets([ticket]);
    return enriched;
  }

  async create(dto: CreateTicketDto, requesterId: number): Promise<Ticket> {
    // Get default status if not provided
    let statusId = dto.statusId;
    if (!statusId) {
      const defaultStatus = await this.statusRepo.findOne({ where: { isDefault: true } });
      statusId = defaultStatus?.id;
    }

    const ticket = this.ticketRepo.create({
      referenceNumber: this.generateReferenceNumber(),
      subject: dto.subject,
      description: dto.description,
      priority: dto.priority || 'medium',
      channel: dto.channel || 'web',
      statusId,
      departmentId: dto.departmentId,
      assigneeId: dto.assigneeId,
      requesterId,
      guestAccessToken: uuidv4(),
    });

    const saved = await this.ticketRepo.save(ticket);

    // Handle tags
    if (dto.tagIds?.length) {
      const tags = await this.tagRepo.findBy({ id: In(dto.tagIds) });
      saved.tags = tags;
      await this.ticketRepo.save(saved);
    }

    // Handle custom fields
    if (dto.customFields) {
      await this.saveCustomFields(saved.id, dto.customFields);
    }

    // Activity log
    await this.activityRepo.save({
      ticketId: saved.id,
      userId: requesterId,
      action: 'created',
      description: 'Ticket created',
    });

    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_CREATED,
      new TicketCreatedEvent(saved, requesterId),
    );

    return this.findById(saved.id);
  }

  async findById(id: number): Promise<Ticket> {
    const ticket = await this.ticketRepo.findOne({
      where: { id },
      relations: ['status', 'department', 'tags'],
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket #${id} not found`);
    }

    return this.enrichTicket(ticket);
  }

  async findByReference(referenceNumber: string): Promise<Ticket> {
    const ticket = await this.ticketRepo.findOne({
      where: { referenceNumber },
      relations: ['status', 'department', 'tags'],
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${referenceNumber} not found`);
    }

    return this.enrichTicket(ticket);
  }

  async findAll(filters: TicketFilterDto): Promise<{ data: Ticket[]; total: number }> {
    const qb = this.ticketRepo
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.status', 'status')
      .leftJoinAndSelect('ticket.department', 'department')
      .leftJoinAndSelect('ticket.tags', 'tags')
      .where('ticket.isMerged = :isMerged', { isMerged: false });

    if (filters.search) {
      qb.andWhere(
        '(ticket.subject LIKE :search OR ticket.referenceNumber LIKE :search OR ticket.description LIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (filters.statusId) {
      qb.andWhere('ticket.statusId = :statusId', { statusId: filters.statusId });
    }

    if (filters.priority) {
      qb.andWhere('ticket.priority = :priority', { priority: filters.priority });
    }

    if (filters.departmentId) {
      qb.andWhere('ticket.departmentId = :departmentId', { departmentId: filters.departmentId });
    }

    if (filters.assigneeId) {
      qb.andWhere('ticket.assigneeId = :assigneeId', { assigneeId: filters.assigneeId });
    }

    if (filters.requesterId) {
      qb.andWhere('ticket.requesterId = :requesterId', { requesterId: filters.requesterId });
    }

    const sortBy = filters.sortBy || 'createdAt';
    const sortDir = (filters.sortDirection?.toUpperCase() as 'ASC' | 'DESC') || 'DESC';
    qb.orderBy(`ticket.${sortBy}`, sortDir);

    const page = filters.page || 1;
    const perPage = filters.perPage || 25;
    qb.skip((page - 1) * perPage).take(perPage);

    const [data, total] = await qb.getManyAndCount();
    await this.enrichTickets(data);
    return { data, total };
  }

  async update(id: number, dto: UpdateTicketDto, userId: number): Promise<Ticket> {
    const ticket = await this.findById(id);
    const changes: Record<string, any> = {};

    if (dto.subject !== undefined && dto.subject !== ticket.subject) {
      changes.subject = { old: ticket.subject, new: dto.subject };
    }

    if (dto.priority !== undefined && dto.priority !== ticket.priority) {
      changes.priority = { old: ticket.priority, new: dto.priority };
      await this.activityRepo.save({
        ticketId: id,
        userId,
        action: 'priority_changed',
        oldValue: { priority: ticket.priority },
        newValue: { priority: dto.priority },
        description: `Priority changed from ${ticket.priority} to ${dto.priority}`,
      });
    }

    // Handle status change
    if (dto.statusId !== undefined && dto.statusId !== ticket.statusId) {
      const previousStatusId = ticket.statusId;
      changes.statusId = { old: previousStatusId, new: dto.statusId };

      const newStatus = await this.statusRepo.findOne({ where: { id: dto.statusId } });
      if (newStatus?.isClosed && !ticket.closedAt) {
        (dto as any).closedAt = new Date();
        (dto as any).resolvedAt = new Date();
      }

      await this.activityRepo.save({
        ticketId: id,
        userId,
        action: 'status_changed',
        oldValue: { statusId: previousStatusId },
        newValue: { statusId: dto.statusId },
        description: 'Status changed',
      });

      this.eventEmitter.emit(
        ESCALATED_EVENTS.TICKET_STATUS_CHANGED,
        new TicketStatusChangedEvent(ticket, previousStatusId, dto.statusId, userId),
      );
    }

    // Handle assignment change
    if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
      const previousAssigneeId = ticket.assigneeId;
      changes.assigneeId = { old: previousAssigneeId, new: dto.assigneeId };

      await this.activityRepo.save({
        ticketId: id,
        userId,
        action: 'assigned',
        oldValue: { assigneeId: previousAssigneeId },
        newValue: { assigneeId: dto.assigneeId },
        description: `Ticket assigned`,
      });

      this.eventEmitter.emit(
        ESCALATED_EVENTS.TICKET_ASSIGNED,
        new TicketAssignedEvent(ticket, previousAssigneeId, dto.assigneeId, userId),
      );
    }

    // Handle snooze
    if (dto.snoozedUntil) {
      const snoozedUntil = new Date(dto.snoozedUntil);
      if (snoozedUntil <= new Date()) {
        throw new BadRequestException('Snooze date must be in the future');
      }
      (dto as any).snoozedUntil = snoozedUntil;

      await this.activityRepo.save({
        ticketId: id,
        userId,
        action: 'snoozed',
        newValue: { snoozedUntil: dto.snoozedUntil },
        description: `Ticket snoozed until ${dto.snoozedUntil}`,
      });
    }

    // Handle tags
    if (dto.tagIds) {
      const tags = await this.tagRepo.findBy({ id: In(dto.tagIds) });
      ticket.tags = tags;
      await this.ticketRepo.save(ticket);
    }

    // Handle custom fields
    if (dto.customFields) {
      await this.saveCustomFields(id, dto.customFields);
    }

    // Apply basic field updates
    const updateData: any = {};
    for (const key of [
      'subject',
      'description',
      'priority',
      'departmentId',
      'assigneeId',
      'statusId',
    ]) {
      if (dto[key] !== undefined) {
        updateData[key] = dto[key];
      }
    }
    if ((dto as any).closedAt) updateData.closedAt = (dto as any).closedAt;
    if ((dto as any).resolvedAt) updateData.resolvedAt = (dto as any).resolvedAt;
    if ((dto as any).snoozedUntil !== undefined)
      updateData.snoozedUntil = (dto as any).snoozedUntil;

    if (Object.keys(updateData).length > 0) {
      await this.ticketRepo.update(id, updateData);
    }

    if (Object.keys(changes).length > 0) {
      this.eventEmitter.emit(
        ESCALATED_EVENTS.TICKET_UPDATED,
        new TicketUpdatedEvent(ticket, changes, userId),
      );
    }

    return this.findById(id);
  }

  async merge(sourceId: number, targetId: number, userId: number): Promise<Ticket> {
    if (sourceId === targetId) {
      throw new BadRequestException('Cannot merge a ticket into itself');
    }

    const source = await this.findById(sourceId);
    const target = await this.findById(targetId);

    await this.ticketRepo.update(sourceId, {
      isMerged: true,
      mergedIntoTicketId: targetId,
    });

    await this.activityRepo.save({
      ticketId: sourceId,
      userId,
      action: 'merged',
      newValue: { mergedIntoTicketId: targetId },
      description: `Merged into ticket #${target.referenceNumber}`,
    });

    await this.activityRepo.save({
      ticketId: targetId,
      userId,
      action: 'merge_received',
      newValue: { mergedFromTicketId: sourceId },
      description: `Received merge from ticket #${source.referenceNumber}`,
    });

    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_MERGED,
      new TicketMergedEvent(source, target, userId),
    );

    return this.findById(targetId);
  }

  async split(ticketId: number, replyIds: number[], userId: number): Promise<Ticket> {
    const original = await this.findById(ticketId);

    const newTicket = await this.create(
      {
        subject: `Split from: ${original.subject}`,
        description: `This ticket was split from ${original.referenceNumber}`,
        priority: original.priority,
        departmentId: original.departmentId,
      },
      userId,
    );

    await this.activityRepo.save({
      ticketId: original.id,
      userId,
      action: 'split',
      newValue: { newTicketId: newTicket.id },
      description: `Ticket split, new ticket #${newTicket.referenceNumber} created`,
    });

    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_SPLIT,
      new TicketSplitEvent(original, newTicket, userId),
    );

    return newTicket;
  }

  async unsnooze(ticketId: number): Promise<void> {
    await this.ticketRepo.update(ticketId, { snoozedUntil: null });

    await this.activityRepo.save({
      ticketId,
      action: 'unsnoozed',
      description: 'Ticket automatically unsnoozed',
    });
  }

  async getActivities(ticketId: number): Promise<TicketActivity[]> {
    return this.activityRepo.find({
      where: { ticketId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Return activities with a human-readable `created_at_human` field appended.
   */
  async getActivitiesWithHumanDates(
    ticketId: number,
  ): Promise<(TicketActivity & { created_at_human: string })[]> {
    const activities = await this.getActivities(ticketId);
    return activities.map((a) => ({
      ...a,
      created_at_human: this.humanReadableDate(a.createdAt),
    }));
  }

  /**
   * Fetch chat context for a ticket: session info and chat messages.
   * Returns null when the ticket has no associated chat session.
   */
  async getChatContext(ticketId: number): Promise<{
    chat_session_id: number;
    chat_started_at: Date;
    chat_messages: Reply[];
    chat_metadata: Record<string, any>;
  } | null> {
    const session = await this.chatSessionRepo.findOne({ where: { ticketId } });
    if (!session) return null;

    const messages = await this.replyRepo.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });

    return {
      chat_session_id: session.id,
      chat_started_at: session.createdAt,
      chat_messages: messages,
      chat_metadata: {
        visitor_name: session.visitorName,
        visitor_email: session.visitorEmail,
        status: session.status,
        agent_id: session.agentId,
        department_id: session.departmentId,
        accepted_at: session.acceptedAt,
        ended_at: session.endedAt,
        last_activity_at: session.lastActivityAt,
      },
    };
  }

  /**
   * Count how many tickets the given requester has submitted.
   */
  async getRequesterTicketCount(requesterId: number): Promise<number> {
    return this.ticketRepo.count({ where: { requesterId } });
  }

  /**
   * Fetch related (linked) tickets with their reference, subject, and status.
   */
  async getRelatedTickets(
    ticketId: number,
  ): Promise<{ id: number; referenceNumber: string; subject: string; status: string }[]> {
    const links = await this.ticketLinkRepo.find({
      where: [{ ticketId }, { linkedTicketId: ticketId }],
    });

    if (links.length === 0) return [];

    const relatedIds = links.map((l) => (l.ticketId === ticketId ? l.linkedTicketId : l.ticketId));

    const tickets = await this.ticketRepo.find({
      where: { id: In(relatedIds) },
      relations: ['status'],
      select: ['id', 'referenceNumber', 'subject', 'statusId'],
    });

    return tickets.map((t) => ({
      id: t.id,
      referenceNumber: t.referenceNumber,
      subject: t.subject,
      status: t.status?.slug || t.status?.name || 'unknown',
    }));
  }

  private humanReadableDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  async delete(id: number): Promise<void> {
    const ticket = await this.findById(id);
    await this.ticketRepo.remove(ticket);
  }

  private async saveCustomFields(
    ticketId: number,
    customFields: Record<string, any>,
  ): Promise<void> {
    for (const [fieldId, value] of Object.entries(customFields)) {
      const existing = await this.customFieldValueRepo.findOne({
        where: {
          customFieldId: parseInt(fieldId, 10),
          entityType: 'ticket',
          entityId: ticketId,
        },
      });

      if (existing) {
        existing.value = String(value);
        await this.customFieldValueRepo.save(existing);
      } else {
        await this.customFieldValueRepo.save({
          customFieldId: parseInt(fieldId, 10),
          entityType: 'ticket',
          entityId: ticketId,
          value: String(value),
        });
      }
    }
  }
}
