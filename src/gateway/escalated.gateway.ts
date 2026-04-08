import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { ESCALATED_EVENTS } from '../events/escalated.events';

@WebSocketGateway({
  namespace: '/escalated',
  cors: { origin: '*' },
})
export class EscalatedGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EscalatedGateway.name);

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:ticket')
  handleJoinTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ): void {
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
  handleJoinAgent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { agentId: number },
  ): void {
    client.join(`agent:${data.agentId}`);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  handleTicketCreated(event: any): void {
    this.server?.emit('ticket:created', {
      ticket: event.ticket,
    });
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_UPDATED)
  handleTicketUpdated(event: any): void {
    const ticketId = event.ticket?.id;
    if (ticketId) {
      this.server?.to(`ticket:${ticketId}`).emit('ticket:updated', {
        ticket: event.ticket,
        changes: event.changes,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_REPLY_CREATED)
  handleReplyCreated(event: any): void {
    const ticketId = event.ticket?.id;
    if (ticketId) {
      this.server?.to(`ticket:${ticketId}`).emit('ticket:reply', {
        reply: event.reply,
        ticketId,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_ASSIGNED)
  handleTicketAssigned(event: any): void {
    if (event.newAssigneeId) {
      this.server?.to(`agent:${event.newAssigneeId}`).emit('ticket:assigned', {
        ticket: event.ticket,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.SLA_BREACHED)
  handleSlaBreached(event: any): void {
    const assigneeId = event.ticket?.assigneeId;
    if (assigneeId) {
      this.server?.to(`agent:${assigneeId}`).emit('sla:breached', {
        ticket: event.ticket,
        breachType: event.breachType,
      });
    }
  }

  // ── Live Chat ──

  @SubscribeMessage('join:chat')
  handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number },
  ): void {
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
  handleJoinChatQueue(@ConnectedSocket() client: Socket): void {
    client.join('chat-queue');
  }

  @SubscribeMessage('chat:typing')
  handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: number; userName: string },
  ): void {
    client.to(`chat:${data.sessionId}`).emit('chat:typing', {
      sessionId: data.sessionId,
      userName: data.userName,
    });
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_STARTED)
  handleChatStarted(event: any): void {
    this.server?.to('chat-queue').emit('chat:started', {
      session: event.session,
    });
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_ACCEPTED)
  handleChatAccepted(event: any): void {
    const sessionId = event.session?.id;
    if (sessionId) {
      this.server?.to(`chat:${sessionId}`).emit('chat:accepted', {
        session: event.session,
        agentId: event.agentId,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_MESSAGE)
  handleChatMessage(event: any): void {
    const sessionId = event.session?.id;
    if (sessionId) {
      this.server?.to(`chat:${sessionId}`).emit('chat:message', {
        reply: event.reply,
        sessionId,
      });
    }
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_ENDED)
  handleChatEnded(event: any): void {
    const sessionId = event.session?.id;
    if (sessionId) {
      this.server?.to(`chat:${sessionId}`).emit('chat:ended', {
        session: event.session,
      });
    }
  }
}
