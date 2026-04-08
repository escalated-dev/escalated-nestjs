import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatSession } from '../entities/chat-session.entity';
import { TicketService } from './ticket.service';
import { ReplyService } from './reply.service';
import { ChatRoutingService } from './chat-routing.service';
import { ESCALATED_EVENTS } from '../events/escalated.events';

@Injectable()
export class ChatSessionService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly chatSessionRepo: Repository<ChatSession>,
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly chatRoutingService: ChatRoutingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Start a new chat session. Creates an underlying ticket with channel "chat".
   */
  async start(
    visitorName: string,
    visitorEmail?: string,
    initialMessage?: string,
    departmentId?: number,
  ): Promise<ChatSession> {
    const ticket = await this.ticketService.create(
      {
        subject: `Chat with ${visitorName}`,
        description: initialMessage || '',
        priority: 'medium',
        channel: 'chat',
      },
      0, // system/guest requester
    );

    const route = await this.chatRoutingService.resolve(departmentId);

    const session = this.chatSessionRepo.create({
      ticketId: ticket.id,
      visitorName,
      visitorEmail,
      departmentId: route.departmentId || departmentId,
      agentId: route.agentId || null,
      status: route.agentId ? 'active' : 'waiting',
      acceptedAt: route.agentId ? new Date() : null,
      lastActivityAt: new Date(),
    });

    const saved = await this.chatSessionRepo.save(session);

    this.eventEmitter.emit(ESCALATED_EVENTS.CHAT_STARTED, { session: saved });

    return saved;
  }

  /**
   * Agent accepts a waiting chat session.
   */
  async accept(sessionId: number, agentId: number): Promise<ChatSession> {
    const session = await this.findById(sessionId);

    if (session.status !== 'waiting') {
      throw new BadRequestException('Chat session is not in a waiting state.');
    }

    session.agentId = agentId;
    session.status = 'active';
    session.acceptedAt = new Date();

    const saved = await this.chatSessionRepo.save(session);

    this.eventEmitter.emit(ESCALATED_EVENTS.CHAT_ACCEPTED, {
      session: saved,
      agentId,
    });

    return saved;
  }

  /**
   * Send a message within a chat session.
   */
  async sendMessage(
    sessionId: number,
    body: string,
    authorId?: number,
    _authorType: string = 'visitor',
  ): Promise<any> {
    const session = await this.findById(sessionId);

    if (session.status === 'ended') {
      throw new BadRequestException('Chat session has ended.');
    }

    const reply = await this.replyService.create(
      session.ticketId,
      { body, type: 'reply' },
      authorId || 0,
    );

    session.lastActivityAt = new Date();
    await this.chatSessionRepo.save(session);

    this.eventEmitter.emit(ESCALATED_EVENTS.CHAT_MESSAGE, {
      session,
      reply,
    });

    return reply;
  }

  /**
   * End a chat session. The underlying ticket is resolved.
   */
  async end(sessionId: number, causerId?: number): Promise<ChatSession> {
    const session = await this.findById(sessionId);

    if (session.status === 'ended') {
      throw new BadRequestException('Chat session has already ended.');
    }

    session.status = 'ended';
    session.endedAt = new Date();

    const saved = await this.chatSessionRepo.save(session);

    this.eventEmitter.emit(ESCALATED_EVENTS.CHAT_ENDED, {
      session: saved,
      causerId,
    });

    return saved;
  }

  async findById(id: number): Promise<ChatSession> {
    const session = await this.chatSessionRepo.findOne({ where: { id } });
    if (!session) {
      throw new NotFoundException(`Chat session not found: ${id}`);
    }
    return session;
  }

  async findByTicketId(ticketId: number): Promise<ChatSession | null> {
    return this.chatSessionRepo.findOne({ where: { ticketId } });
  }

  async getWaitingSessions(): Promise<ChatSession[]> {
    return this.chatSessionRepo.find({
      where: { status: 'waiting' },
      order: { createdAt: 'ASC' },
    });
  }

  async getActiveSessionsForAgent(agentId: number): Promise<ChatSession[]> {
    return this.chatSessionRepo.find({
      where: { agentId, status: 'active' },
      order: { lastActivityAt: 'DESC' },
    });
  }

  async getQueueDepth(departmentId?: number): Promise<number> {
    const where: any = { status: 'waiting' };
    if (departmentId) {
      where.departmentId = departmentId;
    }
    return this.chatSessionRepo.count({ where });
  }

  /**
   * End idle sessions that have had no activity within the timeout period.
   */
  async cleanupIdleSessions(timeoutMinutes: number = 30): Promise<void> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const idleSessions = await this.chatSessionRepo.find({
      where: {
        status: In(['waiting', 'active']),
        lastActivityAt: LessThanOrEqual(cutoff),
      },
    });

    for (const session of idleSessions) {
      try {
        await this.end(session.id);
      } catch {
        // skip sessions that can't be ended
      }
    }
  }
}
