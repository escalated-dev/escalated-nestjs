import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { TicketAccess, TicketActor } from '../config/ticket-access';
import { Ticket } from '../entities/ticket.entity';
import { Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { ESCALATED_EVENTS } from '../events/escalated.events';
import { UserId } from '../config/user-id-column';

@WebSocketGateway({
  namespace: '/escalated',
  cors: { origin: '*' },
})
export class EscalatedGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EscalatedGateway.name);

  constructor(@Optional() private readonly access?: TicketAccess) {}

  async handleConnection(client: Socket): Promise<void> {
    if (this.access?.enabled()) {
      try {
        const actor = await this.access.requestActor(client.request);
        client.data.escalatedUserId = actor?.id ?? null;
        client.data.escalatedGuestToken = actor ? null : client.handshake.auth?.guestToken;
        if (!actor && !client.data.escalatedGuestToken) {
          client.disconnect(true);
          return;
        }
      } catch {
        client.disconnect(true);
        return;
      }
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
    if (this.access?.enabled() && !(await this.socketCanSee(client, data.ticketId))) return;
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
    if (this.access?.enabled()) {
      const actor = await this.socketActor(client);
      if (!actor || String(actor.id) !== String(data.agentId) || (!actor.isAgent && !actor.isAdmin))
        return;
    }
    client.join(`agent:${data.agentId}`);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  handleTicketCreated(event: any): void {
    this.emitScoped(undefined, 'ticket:created', {
      ticket: event.ticket,
    });
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
      this.emitScoped(`ticket:${ticketId}`, 'ticket:reply', {
        reply: event.reply,
        ticketId,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_ASSIGNED)
  handleTicketAssigned(event: any): void {
    if (event.newAssigneeId) {
      this.emitScoped(`agent:${event.newAssigneeId}`, 'ticket:assigned', {
        ticket: event.ticket,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.SLA_BREACHED)
  handleSlaBreached(event: any): void {
    const assigneeId = event.ticket?.assigneeId;
    if (assigneeId) {
      this.emitScoped(`agent:${assigneeId}`, 'sla:breached', {
        ticket: event.ticket,
        breachType: event.breachType,
      });
    }
  }

  // ── Live Chat ──

  @SubscribeMessage('join:chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ): Promise<void> {
    if (this.access?.enabled() && !(await this.socketCanSeeChat(client, data.sessionId))) return;
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
    if (this.access?.enabled()) {
      const actor = await this.socketActor(client);
      if (!actor?.isAgent && !actor?.isAdmin) return;
    }
    client.join('chat-queue');
  }

  @SubscribeMessage('chat:typing')
  async handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number; userName: string },
  ): Promise<void> {
    if (this.access?.enabled() && !(await this.socketCanSeeChat(client, data.sessionId))) return;
    this.emitScoped(`chat:${data.sessionId}`, 'chat:typing', {
      sessionId: data.sessionId,
      userName: data.userName,
    });
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_STARTED)
  handleChatStarted(event: any): void {
    this.emitScoped('chat-queue', 'chat:started', {
      session: event.session,
    });
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
      this.emitScoped(`chat:${sessionId}`, 'chat:message', {
        reply: event.reply,
        sessionId,
      });
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

  private async socketActor(client: { data: any }): Promise<TicketActor | null> {
    if (client.data.escalatedUserId == null) return null;
    return this.access!.resolveUser(client.data.escalatedUserId);
  }

  private async socketCanSee(client: { data: any }, ticketId: number): Promise<boolean> {
    if (!this.access?.enabled()) return true;
    const ticket = await this.access.withActor(null, () =>
      this.access!.source.getRepository(Ticket).findOneBy({ id: ticketId }),
    );
    if (!ticket) return false;
    const actor = await this.socketActor(client);
    if (!actor)
      return (
        !!client.data.escalatedGuestToken &&
        client.data.escalatedGuestToken === ticket.guestAccessToken
      );
    if (actor.isAdmin) return true;
    if (!actor.isAgent) return String(actor.id) === String(ticket.requesterId);
    return this.access.allows(actor, ticket);
  }

  private async socketCanSeeChat(client: { data: any }, sessionId: number): Promise<boolean> {
    if (!this.access?.enabled()) return true;
    const session = await this.access.withActor(null, () =>
      this.access!.source.getRepository('ChatSession').findOneBy({ id: sessionId }),
    );
    return !!session && this.socketCanSee(client, session.ticketId);
  }

  private emitScoped(room: string | undefined, event: string, payload: any): void {
    if (!this.server) return;
    if (!this.access?.enabled()) {
      (room ? this.server.to(room) : this.server).emit(event, payload);
      return;
    }
    this.deliverScoped(room, event, payload).catch((error) =>
      this.logger.warn(`Scoped broadcast failed: ${error.message}`),
    );
  }

  private async deliverScoped(
    room: string | undefined,
    event: string,
    payload: any,
  ): Promise<void> {
    const sockets = await this.server.fetchSockets();
    const ticketId = payload.ticket?.id ?? payload.ticketId ?? payload.session?.ticketId;
    for (const client of sockets) {
      if (room && !client.rooms.has(room)) continue;
      const allowed = ticketId
        ? await this.socketCanSee(client, ticketId)
        : payload.sessionId
          ? await this.socketCanSeeChat(client, payload.sessionId)
          : false;
      if (allowed) client.emit(event, payload);
    }
  }
}
