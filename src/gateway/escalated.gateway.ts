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
}
