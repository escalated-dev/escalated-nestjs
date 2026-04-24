import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WorkflowRunnerService } from '../services/workflow-runner.service';
import {
  ESCALATED_EVENTS,
  TicketAssignedEvent,
  TicketCreatedEvent,
  TicketReplyCreatedEvent,
  TicketStatusChangedEvent,
  TicketUpdatedEvent,
} from '../events/escalated.events';

/**
 * Bridges the application event bus to the Workflow runner. Each mapped
 * event is translated to the frontend-facing trigger event string that
 * WorkflowRunnerService queries against.
 */
@Injectable()
export class WorkflowListener {
  constructor(private readonly runner: WorkflowRunnerService) {}

  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  async onTicketCreated(event: TicketCreatedEvent): Promise<void> {
    await this.runner.runForEvent('ticket.created', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_UPDATED)
  async onTicketUpdated(event: TicketUpdatedEvent): Promise<void> {
    await this.runner.runForEvent('ticket.updated', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_ASSIGNED)
  async onTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    await this.runner.runForEvent('ticket.assigned', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_STATUS_CHANGED)
  async onTicketStatusChanged(event: TicketStatusChangedEvent): Promise<void> {
    await this.runner.runForEvent('ticket.status_changed', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_REPLY_CREATED)
  async onReplyCreated(event: TicketReplyCreatedEvent): Promise<void> {
    await this.runner.runForEvent('reply.created', event.ticket);
  }
}
