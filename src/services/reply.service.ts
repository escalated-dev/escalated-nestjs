import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Reply } from '../entities/reply.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { AgentProfile } from '../entities/agent-profile.entity';
import { CreateReplyDto } from '../dto/create-reply.dto';
import { UserId } from '../config/user-id-column';
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
    @InjectRepository(AgentProfile)
    private readonly agentProfileRepo: Repository<AgentProfile>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Resolve a human display name for a reply author, mirroring the
   * AgentProfile.displayName lookup used by TicketService.enrichTickets so the
   * real-time payload renders the same name the HTTP response would.
   */
  private async resolveAuthorName(userId: UserId): Promise<string> {
    if (userId === null || userId === undefined) {
      return null;
    }
    const profile = await this.agentProfileRepo.findOne({
      where: { userId },
      select: ['userId', 'displayName'],
    });
    return profile?.displayName ?? `User #${userId}`;
  }

  async create(ticketId: number, dto: CreateReplyDto, userId: UserId): Promise<Reply> {
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

    // Attach a resolved author so the broadcast payload carries a display name
    // (the Reply entity only stores the scalar userId). Without this, real-time
    // consumers render "Unknown" until a full refetch enriches the reply.
    const authorName = await this.resolveAuthorName(userId);
    (saved as Reply & { author?: { id: UserId; name: string }; authorName?: string }).author =
      userId === null || userId === undefined ? null : { id: userId, name: authorName };
    (saved as Reply & { authorName?: string }).authorName = authorName;

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
      relations: ['attachments'],
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
