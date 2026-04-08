import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Reply } from '../entities/reply.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { CreateReplyDto } from '../dto/create-reply.dto';
import { ESCALATED_EVENTS, TicketReplyCreatedEvent } from '../events/escalated.events';

@Injectable()
export class ReplyService {
  constructor(
    @InjectRepository(Reply)
    private readonly replyRepo: Repository<Reply>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(TicketActivity)
    private readonly activityRepo: Repository<TicketActivity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(ticketId: number, dto: CreateReplyDto, userId: number): Promise<Reply> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) {
      throw new NotFoundException(`Ticket #${ticketId} not found`);
    }

    const reply = this.replyRepo.create({
      ticketId,
      userId,
      body: dto.body,
      type: dto.type || 'reply',
      isInternal: dto.isInternal || false,
    });

    const saved = await this.replyRepo.save(reply);

    // Track first response for SLA
    if (!ticket.firstRespondedAt && !dto.isInternal && ticket.requesterId !== userId) {
      await this.ticketRepo.update(ticketId, { firstRespondedAt: new Date() });
    }

    // Activity log
    await this.activityRepo.save({
      ticketId,
      userId,
      action: dto.isInternal ? 'internal_note_added' : 'reply_added',
      description: dto.isInternal ? 'Internal note added' : 'Reply added',
    });

    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_REPLY_CREATED,
      new TicketReplyCreatedEvent(saved, ticket, userId),
    );

    return saved;
  }

  async findByTicketId(ticketId: number, includeInternal: boolean = true): Promise<Reply[]> {
    const where: any = { ticketId };
    if (!includeInternal) {
      where.isInternal = false;
    }

    return this.replyRepo.find({
      where,
      order: { createdAt: 'ASC' },
    });
  }

  async findById(id: number): Promise<Reply> {
    const reply = await this.replyRepo.findOne({ where: { id } });
    if (!reply) {
      throw new NotFoundException(`Reply #${id} not found`);
    }
    return reply;
  }

  async delete(id: number): Promise<void> {
    const reply = await this.findById(id);
    await this.replyRepo.remove(reply);
  }
}
