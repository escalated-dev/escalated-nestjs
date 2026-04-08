import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
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

    return ticket;
  }

  async findByReference(referenceNumber: string): Promise<Ticket> {
    const ticket = await this.ticketRepo.findOne({
      where: { referenceNumber },
      relations: ['status', 'department', 'tags'],
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${referenceNumber} not found`);
    }

    return ticket;
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
