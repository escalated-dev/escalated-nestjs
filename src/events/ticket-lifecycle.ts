import { UserId } from '../config/user-id-column';
import {
  ESCALATED_EVENTS,
  TicketClosedEvent,
  TicketReopenedEvent,
  TicketResolvedEvent,
} from './escalated.events';

interface StatusLike {
  slug?: string | null;
  isClosed?: boolean | null;
}

/** A resolved or closed status. */
export function isTerminalStatus(status: StatusLike | null | undefined): boolean {
  if (!status) return false;
  return Boolean(status.isClosed) || status.slug === 'resolved' || status.slug === 'closed';
}

/**
 * The lifecycle event a status change announces, beside `ticket.status_changed`:
 * `ticket.resolved` for the `resolved` status, `ticket.closed` for any other
 * closed status, and `ticket.reopened` when a resolved or closed ticket moves
 * back to an open status.
 */
export function lifecycleEvent(
  previous: StatusLike | null | undefined,
  next: StatusLike | null | undefined,
  ticket: any,
  userId: UserId,
): [string, object] | null {
  if (!next) return null;
  if (next.slug === 'resolved') {
    return [ESCALATED_EVENTS.TICKET_RESOLVED, new TicketResolvedEvent(ticket, userId)];
  }
  if (isTerminalStatus(next)) {
    return [ESCALATED_EVENTS.TICKET_CLOSED, new TicketClosedEvent(ticket, userId)];
  }
  if (isTerminalStatus(previous)) {
    return [ESCALATED_EVENTS.TICKET_REOPENED, new TicketReopenedEvent(ticket, userId)];
  }
  return null;
}
