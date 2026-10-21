import { Injectable, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowRunnerService } from '../services/workflow-runner.service';
import { Ticket } from '../entities/ticket.entity';
import { ESCALATED_EVENTS, TicketReplyCreatedEvent } from '../events/escalated.events';

export { WORKFLOW_TRIGGERS } from '../events/workflow-triggers';

/**
 * Bridges the application event bus to the Workflow runner. Each mapped
 * event is translated to its canonical trigger name, which
 * WorkflowRunnerService queries against (legacy stored names included).
 */
@Injectable()
export class WorkflowListener {
  constructor(
    private readonly runner: WorkflowRunnerService,
    @Optional() @InjectRepository(Ticket) private readonly ticketRepo?: Repository<Ticket>,
  ) {}

  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  async onTicketCreated(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.created', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_UPDATED)
  async onTicketUpdated(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.updated', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_ASSIGNED)
  async onTicketAssigned(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.assigned', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_UNASSIGNED)
  async onTicketUnassigned(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.unassigned', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_STATUS_CHANGED)
  async onTicketStatusChanged(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.status_changed', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_RESOLVED)
  async onTicketResolved(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.resolved', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_CLOSED)
  async onTicketClosed(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.closed', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_REOPENED)
  async onTicketReopened(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.reopened', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_ESCALATED)
  async onTicketEscalated(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.escalated', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_PRIORITY_CHANGED)
  async onPriorityChanged(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.priority_changed', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_DEPARTMENT_CHANGED)
  async onDepartmentChanged(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.department_changed', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_TAG_ADDED)
  async onTagAdded(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.tag_added', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_TAG_REMOVED)
  async onTagRemoved(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('ticket.tag_removed', event.ticket);
  }

  /** Public replies only; internal notes fire `note.created`. */
  @OnEvent(ESCALATED_EVENTS.TICKET_REPLY_CREATED)
  async onReplyCreated(event: TicketReplyCreatedEvent): Promise<void> {
    if (event.reply?.isInternal) return;
    await this.runner.runForEvent('reply.created', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.NOTE_CREATED)
  async onNoteCreated(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('note.created', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.SLA_WARNING)
  async onSlaWarning(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('sla.warning', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.SLA_BREACHED)
  async onSlaBreached(event: { ticket: Ticket }): Promise<void> {
    await this.runner.runForEvent('sla.breached', event.ticket);
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_STARTED)
  async onChatStarted(event: { session: { ticketId: number } }): Promise<void> {
    await this.runForChat('chat.started', event);
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_ASSIGNED)
  async onChatAssigned(event: { session: { ticketId: number } }): Promise<void> {
    await this.runForChat('chat.assigned', event);
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_TRANSFERRED)
  async onChatTransferred(event: { session: { ticketId: number } }): Promise<void> {
    await this.runForChat('chat.transferred', event);
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_MESSAGE)
  async onChatMessage(event: { session: { ticketId: number } }): Promise<void> {
    await this.runForChat('chat.message', event);
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_ENDED)
  async onChatEnded(event: { session: { ticketId: number } }): Promise<void> {
    await this.runForChat('chat.ended', event);
  }

  private async runForChat(
    trigger: string,
    event: { session?: { ticketId?: number } },
  ): Promise<void> {
    const ticketId = event?.session?.ticketId;
    if (!ticketId || !this.ticketRepo) return;
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (ticket) await this.runner.runForEvent(trigger, ticket);
  }
}
