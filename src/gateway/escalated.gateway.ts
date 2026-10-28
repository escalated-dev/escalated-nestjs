import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { createHash, timingSafeEqual } from 'crypto';
import { GuestAccessService } from '../services/guest-access.service';
import { TicketAccess, TicketActor } from '../config/ticket-access';
import { embedOrigin } from '../config/widget-embed';
import { Ticket } from '../entities/ticket.entity';
import { Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { ESCALATED_EVENTS } from '../events/escalated.events';
import { UserId } from '../config/user-id-column';

/** Payload fields that grant access and must never be broadcast. */
const SECRET_FIELDS = [
  'guestAccessToken',
  'guest_access_token',
  'guestAccessHash',
  'guestVerifiedEmail',
  'visitorTokenHash',
];

interface DeliveryOptions {
  /** Only agent/admin sockets receive it (internal notes, queues, new tickets). */
  staffOnly?: boolean;
}

/**
 * Socket.IO gateway (opt-in with `enableWebsockets`).
 *
 * Every connection must identify itself. A host user is identified by
 * `websocketAuth(socket)`, else `userResolver(handshake request)`, else a
 * `user` the host's socket middleware put on the handshake request. Roles come
 * from `ticketAccess.resolveUser`; without it an identified user is treated as
 * a customer, so agent rooms stay closed (fail closed). Guests connect with
 * `handshake.auth.guestToken` (the ticket's guest token) or
 * `handshake.auth.chatToken` (the widget chat visitor token), and can only join
 * that ticket or chat. Anything else is disconnected.
 *
 * Deliveries are re-checked per socket: new tickets, queue events, SLA and
 * assignment events go to agents only, internal notes never reach guest or
 * customer sockets, and guest tokens are stripped from every payload.
 */
@WebSocketGateway({
  namespace: '/escalated',
  cors: { origin: '*' },
})
export class EscalatedGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EscalatedGateway.name);

  constructor(
    @Optional() private readonly access?: TicketAccess,
    @Optional() private readonly guestAccess?: GuestAccessService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const userId = await this.identify(client);
      const auth = (client.handshake?.auth ?? {}) as Record<string, unknown>;
      client.data.escalatedUserId = userId;
      client.data.escalatedGuestToken =
        typeof auth.guestToken === 'string' && auth.guestToken ? auth.guestToken : null;
      client.data.escalatedChatToken =
        typeof auth.chatToken === 'string' && auth.chatToken ? auth.chatToken : null;
      if (userId == null && !client.data.escalatedGuestToken && !client.data.escalatedChatToken) {
        client.disconnect(true);
        return;
      }
    } catch {
      client.disconnect(true);
      return;
    }
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:ticket')
  async handleJoinTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ): Promise<void> {
    if (!(await this.socketCanSee(client, data?.ticketId))) return;
    client.join(`ticket:${data.ticketId}`);
    this.logger.log(`Client ${client.id} joined ticket:${data.ticketId}`);
  }

  @SubscribeMessage('leave:ticket')
  handleLeaveTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ): void {
    client.leave(`ticket:${data.ticketId}`);
  }

  @SubscribeMessage('join:agent')
  async handleJoinAgent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { agentId: UserId },
  ): Promise<void> {
    const actor = await this.socketActor(client);
    if (!actor || (!actor.isAgent && !actor.isAdmin)) return;
    if (data?.agentId == null || String(actor.id) !== String(data.agentId)) return;
    client.join(`agent:${data.agentId}`);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  handleTicketCreated(event: any): void {
    this.emitScoped(undefined, 'ticket:created', { ticket: event.ticket }, { staffOnly: true });
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_UPDATED)
  handleTicketUpdated(event: any): void {
    const ticketId = event.ticket?.id;
    if (ticketId) {
      this.emitScoped(`ticket:${ticketId}`, 'ticket:updated', {
        ticket: event.ticket,
        changes: event.changes,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_REPLY_CREATED)
  handleReplyCreated(event: any): void {
    const ticketId = event.ticket?.id;
    if (ticketId) {
      this.emitScoped(
        `ticket:${ticketId}`,
        'ticket:reply',
        { reply: event.reply, ticketId },
        { staffOnly: isInternalReply(event.reply) },
      );
    }
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_ASSIGNED)
  handleTicketAssigned(event: any): void {
    if (event.newAssigneeId) {
      this.emitScoped(
        `agent:${event.newAssigneeId}`,
        'ticket:assigned',
        { ticket: event.ticket },
        { staffOnly: true },
      );
    }
  }

  @OnEvent(ESCALATED_EVENTS.SLA_BREACHED)
  handleSlaBreached(event: any): void {
    const assigneeId = event.ticket?.assigneeId;
    if (assigneeId) {
      this.emitScoped(
        `agent:${assigneeId}`,
        'sla:breached',
        { ticket: event.ticket, breachType: event.breachType },
        { staffOnly: true },
      );
    }
  }

  // ── Live Chat ──

  @SubscribeMessage('join:chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ): Promise<void> {
    if (!(await this.socketCanSeeChat(client, data?.sessionId))) return;
    client.join(`chat:${data.sessionId}`);
    this.logger.log(`Client ${client.id} joined chat:${data.sessionId}`);
  }

  @SubscribeMessage('leave:chat')
  handleLeaveChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ): void {
    client.leave(`chat:${data.sessionId}`);
  }

  @SubscribeMessage('join:chat-queue')
  async handleJoinChatQueue(@ConnectedSocket() client: Socket): Promise<void> {
    if (!(await this.isStaff(client))) return;
    client.join('chat-queue');
  }

  @SubscribeMessage('chat:typing')
  async handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number; userName: string },
  ): Promise<void> {
    if (!(await this.socketCanSeeChat(client, data?.sessionId))) return;
    this.emitScoped(`chat:${data.sessionId}`, 'chat:typing', {
      sessionId: data.sessionId,
      userName: data.userName,
    });
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_STARTED)
  handleChatStarted(event: any): void {
    this.emitScoped('chat-queue', 'chat:started', { session: event.session }, { staffOnly: true });
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_ACCEPTED)
  handleChatAccepted(event: any): void {
    const sessionId = event.session?.id;
    if (sessionId) {
      this.emitScoped(`chat:${sessionId}`, 'chat:accepted', {
        session: event.session,
        agentId: event.agentId,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_MESSAGE)
  handleChatMessage(event: any): void {
    const sessionId = event.session?.id;
    if (sessionId) {
      this.emitScoped(
        `chat:${sessionId}`,
        'chat:message',
        { reply: event.reply, sessionId },
        { staffOnly: isInternalReply(event.reply) },
      );
    }
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_ENDED)
  handleChatEnded(event: any): void {
    const sessionId = event.session?.id;
    if (sessionId) {
      this.emitScoped(`chat:${sessionId}`, 'chat:ended', {
        session: event.session,
      });
    }
  }

  /** The host user behind a connection, or null for a guest/anonymous socket. */
  private async identify(client: Socket): Promise<UserId | null> {
    const options = this.access?.options;
    const request: any = client.request;
    // A widget embedded on another site is always a guest.
    if (embedOrigin(request)) return null;
    if (options?.websocketAuth) {
      const id = await options.websocketAuth(client);
      return id == null || id === '' ? null : id;
    }
    const user = options?.userResolver ? options.userResolver(request) : request?.user;
    const id = user?.id;
    return id == null || id === '' ? null : id;
  }

  private async socketActor(client: { data: any }): Promise<TicketActor | null> {
    const id = client.data?.escalatedUserId;
    if (id == null || !this.access) return null;
    if (!this.access.options.ticketAccess?.resolveUser) {
      // Roles are unknown: never staff.
      return { id, isAgent: false, isAdmin: false };
    }
    try {
      return await this.access.resolveUser(id);
    } catch (error) {
      this.logger.warn(`Socket user could not be resolved: ${(error as Error).message}`);
      return null;
    }
  }

  private async isStaff(client: { data: any }): Promise<boolean> {
    const actor = await this.socketActor(client);
    return !!actor && (actor.isAgent || actor.isAdmin);
  }

  private async findTicket(ticketId: unknown): Promise<Ticket | null> {
    const id = Number(ticketId);
    if (!this.access || !Number.isInteger(id) || id <= 0) return null;
    return this.access.withActor(null, () =>
      this.access!.source.getRepository(Ticket).findOneBy({ id }),
    );
  }

  private async socketCanSee(
    client: { data: any },
    ticketOrId: Ticket | number | null | undefined,
  ): Promise<boolean> {
    const ticket =
      ticketOrId && typeof ticketOrId === 'object' ? ticketOrId : await this.findTicket(ticketOrId);
    if (!ticket || !this.access) return false;
    const actor = await this.socketActor(client);
    if (actor) {
      if (actor.isAdmin) return true;
      if (actor.isAgent) return this.access.allows(actor, ticket);
      if (String(actor.id) === String(ticket.requesterId)) return true;
    }
    // A guest grant for this ticket, or (only with `guestAccess.legacyTokens`)
    // its permanent pre-verification token.
    const token = client.data?.escalatedGuestToken;
    if (!token) return false;
    if (this.guestAccess) {
      const granted = await this.guestAccess.ticketForToken(token);
      return !!granted && granted.id === ticket.id;
    }
    return tokensMatch(token, ticket.guestAccessToken);
  }

  private async findChat(sessionId: unknown): Promise<any | null> {
    const id = Number(sessionId);
    if (!this.access || !Number.isInteger(id) || id <= 0) return null;
    return this.access.withActor(null, () =>
      this.access!.source.getRepository('ChatSession').findOneBy({ id }),
    );
  }

  private async socketCanSeeChat(client: { data: any }, sessionId: unknown): Promise<boolean> {
    const session = await this.findChat(sessionId);
    if (!session) return false;
    const chatToken = client.data?.escalatedChatToken;
    if (
      typeof chatToken === 'string' &&
      chatToken &&
      session.visitorTokenHash &&
      !(
        session.visitorTokenExpiresAt &&
        new Date(session.visitorTokenExpiresAt).getTime() <= Date.now()
      ) &&
      tokensMatch(createHash('sha256').update(chatToken).digest('hex'), session.visitorTokenHash)
    )
      return true;
    return this.socketCanSee(client, session.ticketId);
  }

  private emitScoped(
    room: string | undefined,
    event: string,
    payload: any,
    options: DeliveryOptions = {},
  ): void {
    if (!this.server) return;
    this.deliverScoped(room, event, payload, options).catch((error) =>
      this.logger.warn(`Scoped broadcast failed: ${error.message}`),
    );
  }

  /** Delivers to each socket that is in `room` (if any) and may see the ticket. */
  private async deliverScoped(
    room: string | undefined,
    event: string,
    payload: any,
    options: DeliveryOptions = {},
  ): Promise<void> {
    const sockets = await this.server.fetchSockets();
    const safe = stripSecrets(payload);
    const ticketId = payload.ticket?.id ?? payload.ticketId ?? payload.session?.ticketId;
    const ticket = ticketId ? await this.findTicket(ticketId) : null;
    for (const client of sockets) {
      if (room && !client.rooms.has(room)) continue;
      if (options.staffOnly && !(await this.isStaff(client))) continue;
      const allowed = ticketId
        ? await this.socketCanSee(client, ticket)
        : payload.sessionId
          ? await this.socketCanSeeChat(client, payload.sessionId)
          : false;
      if (allowed) client.emit(event, safe);
    }
  }
}

function isInternalReply(reply: any): boolean {
  return !!reply && (reply.isInternal === true || reply.type === 'note');
}

function tokensMatch(given: unknown, expected: unknown): boolean {
  if (typeof given !== 'string' || typeof expected !== 'string' || !given || !expected)
    return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A copy of the payload without access tokens, at any depth that matters. */
function stripSecrets(value: any, depth = 0): any {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1));
  const copy: Record<string, any> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_FIELDS.includes(key)) continue;
    copy[key] = stripSecrets(inner, depth + 1);
  }
  return copy;
}
