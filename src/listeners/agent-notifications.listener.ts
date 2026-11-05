import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { UserId } from '../config/user-id-column';
import {
  ChatTransferredEvent,
  ESCALATED_EVENTS,
  SlaBreachedEvent,
  SlaWarningEvent,
  TicketAssignedEvent,
  TicketReplyCreatedEvent,
} from '../events/escalated.events';
import { AgentNotificationsService } from '../services/agent-notifications.service';
import { isCustomerSideReply } from '../services/ticket-reads.service';

/**
 * Turns events into the agents' in-app notifications (ADR
 * 2026-11-05-agent-panel-data, section 4). The agent who caused an event is
 * never notified of it. A failure here never fails the action that raised it.
 */
@Injectable()
export class AgentNotificationsListener {
  private readonly logger = new Logger(AgentNotificationsListener.name);

  constructor(private readonly feed: AgentNotificationsService) {}

  @OnEvent(ESCALATED_EVENTS.TICKET_ASSIGNED)
  async assigned(event: TicketAssignedEvent): Promise<void> {
    await this.safely(() =>
      this.feed.notify(event.newAssigneeId, 'ticket_assigned', event.ticket, {}, event.userId),
    );
  }

  /** A customer-side public reply: the assignee and the followers. */
  @OnEvent(ESCALATED_EVENTS.TICKET_REPLY_CREATED)
  async replied(event: TicketReplyCreatedEvent): Promise<void> {
    if (!isCustomerSideReply(event.reply ?? {}, event.ticket ?? {})) return;
    const recipients = new Map<string, UserId>();
    for (const id of [event.ticket?.assigneeId, ...(event.followerUserIds ?? [])]) {
      if (id != null && String(id) !== '' && String(id) !== '0') recipients.set(String(id), id);
    }
    await this.safely(async () => {
      for (const agent of recipients.values()) {
        await this.feed.notify(agent, 'ticket_reply', event.ticket, {}, event.userId);
      }
    });
  }

  @OnEvent(ESCALATED_EVENTS.SLA_WARNING)
  async slaWarning(event: SlaWarningEvent): Promise<void> {
    await this.safely(() =>
      this.feed.notify(event.ticket?.assigneeId, 'sla_warning', event.ticket, {
        sla_type: event.warningType,
        minutes_remaining: event.minutesRemaining,
      }),
    );
  }

  @OnEvent(ESCALATED_EVENTS.SLA_BREACHED)
  async slaBreached(event: SlaBreachedEvent): Promise<void> {
    await this.safely(() =>
      this.feed.notify(event.ticket?.assigneeId, 'sla_breached', event.ticket, {
        sla_type: event.breachType,
      }),
    );
  }

  @OnEvent(ESCALATED_EVENTS.CHAT_TRANSFERRED)
  async chatTransferred(event: ChatTransferredEvent): Promise<void> {
    const ticketId = event.session?.ticketId;
    await this.safely(() =>
      this.feed.notify(
        event.toAgentId,
        'chat_transferred',
        ticketId ? { id: ticketId, referenceNumber: event.session?.ticket?.referenceNumber } : null,
        { session_id: event.session?.id ?? null },
        event.fromAgentId,
      ),
    );
  }

  private async safely(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(`Agent notification failed: ${(error as Error).message}`);
    }
  }
}
