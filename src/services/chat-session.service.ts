import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes } from 'crypto';
import { ChatSession } from '../entities/chat-session.entity';
import { AgentProfile } from '../entities/agent-profile.entity';
import { Reply } from '../entities/reply.entity';
import { TicketService } from './ticket.service';
import { ReplyService } from './reply.service';
import { ChatRoutingService } from './chat-routing.service';
import { ESCALATED_EVENTS } from '../events/escalated.events';
import { TicketAccess } from '../config/ticket-access';
import { UserId } from '../config/user-id-column';

/** One line of a chat transcript, in the shape the shared widget reads. */
export interface ChatTranscriptMessage {
  id: number;
  body: string;
  is_agent: boolean;
  author: { name: string };
  created_at: string;
}

function hashVisitorToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Visitor messages are stored with no user (0); anything else is staff. */
function isStaffAuthor(userId: UserId | null | undefined): boolean {
  return userId !== null && userId !== undefined && userId !== '' && String(userId) !== '0';
}

@Injectable()
export class ChatSessionService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly chatSessionRepo: Repository<ChatSession>,
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly chatRoutingService: ChatRoutingService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly access?: TicketAccess,
    @Optional()
    @InjectRepository(AgentProfile)
    private readonly agentProfileRepo?: Repository<AgentProfile>,
  ) {}

  /**
   * Start a new chat session. Creates an underlying ticket with channel "chat".
   */
  async start(
    visitorName: string,
    visitorEmail?: string,
    initialMessage?: string,
    departmentId?: number,
    metadata?: Record<string, string | number | boolean> | null,
  ): Promise<ChatSession> {
    const route = await this.chatRoutingService.resolve(departmentId);
    const ticket = await this.ticketService.create(
      {
        subject: `Chat with ${visitorName}`,
        description: initialMessage || '',
        priority: 'medium',
        channel: 'chat',
        departmentId: route.departmentId ?? departmentId,
        metadata: metadata ?? null,
      },
      0, // system/guest requester
    );

    if (
      this.access?.enabled() &&
      route.agentId &&
      !(await this.access.allowsAgent(route.agentId, ticket))
    )
      route.agentId = null;

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
  async accept(sessionId: number, agentId: UserId): Promise<ChatSession> {
    const session = await this.findById(sessionId);

    if (
      this.access?.enabled() &&
      !(await this.access.allowsAgent(agentId, await this.ticketService.findById(session.ticketId)))
    )
      throw new BadRequestException('Agent cannot access this ticket');

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
    authorId?: UserId,
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
  async end(sessionId: number, causerId?: UserId): Promise<ChatSession> {
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

  /**
   * Give the visitor of a chat a fresh, unguessable token. Only its hash is
   * stored, so the token is returned once and cannot be read back.
   */
  async issueVisitorToken(session: ChatSession): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.chatSessionRepo.update(session.id, { visitorTokenHash: hashVisitorToken(token) });
    return token;
  }

  /** The chat a visitor token belongs to; 404 for anything else. */
  async findByVisitorToken(token: string): Promise<ChatSession> {
    const session = token
      ? await this.chatSessionRepo.findOne({
          where: { visitorTokenHash: hashVisitorToken(token) },
        })
      : null;
    if (!session) {
      throw new NotFoundException('Chat session not found');
    }
    return session;
  }

  /**
   * The public transcript of a chat: the visitor's opening message, then every
   * non-internal reply, oldest first.
   */
  async transcript(session: ChatSession): Promise<{
    messages: ChatTranscriptMessage[];
    agent: { name: string } | null;
  }> {
    const ticket = await this.ticketService.findById(session.ticketId);
    const replies: Reply[] = (await this.replyService.findByTicketId(session.ticketId, false))
      .filter((reply) => reply.type !== 'note')
      .slice(-100);
    const names = await this.staffNames([...replies.map((reply) => reply.userId), session.agentId]);
    const staffName = (id: UserId) => names.get(String(id)) ?? 'Agent';

    const messages: ChatTranscriptMessage[] = replies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      is_agent: isStaffAuthor(reply.userId),
      author: { name: isStaffAuthor(reply.userId) ? staffName(reply.userId) : session.visitorName },
      created_at: new Date(reply.createdAt).toISOString(),
    }));
    if (ticket.description) {
      messages.unshift({
        id: 0,
        body: ticket.description,
        is_agent: false,
        author: { name: session.visitorName },
        created_at: new Date(ticket.createdAt).toISOString(),
      });
    }

    return {
      messages,
      agent: isStaffAuthor(session.agentId) ? { name: staffName(session.agentId!) } : null,
    };
  }

  /** Records visitor activity for the typing signal; ended chats refuse it. */
  async visitorTyping(session: ChatSession): Promise<void> {
    if (session.status === 'ended') {
      throw new BadRequestException('Chat session has ended.');
    }
    await this.chatSessionRepo.update(session.id, { lastActivityAt: new Date() });
  }

  private async staffNames(ids: Array<UserId | null | undefined>): Promise<Map<string, string>> {
    const staff = [...new Set(ids.filter(isStaffAuthor))] as UserId[];
    if (!staff.length || !this.agentProfileRepo) return new Map();
    const profiles = await this.agentProfileRepo.find({ where: { userId: In(staff) } });
    return new Map(
      profiles
        .filter((profile) => profile.displayName)
        .map((profile) => [String(profile.userId), profile.displayName]),
    );
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

  async getActiveSessionsForAgent(agentId: UserId): Promise<ChatSession[]> {
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
