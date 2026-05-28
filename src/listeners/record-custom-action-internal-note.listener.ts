import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReplyService } from '../services/reply.service';
import { ESCALATED_EVENTS, TicketCustomActionTriggeredEvent } from '../events/escalated.events';

/**
 * Records an internal note on the ticket whenever a custom action is triggered,
 * giving an audit trail of who ran which action. The note is authored by the
 * triggering agent (via `userId`), so the body need not repeat their name.
 */
@Injectable()
export class RecordCustomActionInternalNoteListener {
  constructor(private readonly replyService: ReplyService) {}

  @OnEvent(ESCALATED_EVENTS.TICKET_CUSTOM_ACTION_TRIGGERED)
  async handle(event: TicketCustomActionTriggeredEvent): Promise<void> {
    await this.replyService.create(
      event.ticket.id,
      {
        body: `Custom action "${event.action}" was triggered.`,
        isInternal: true,
        type: 'note',
      },
      event.userId,
    );
  }
}
