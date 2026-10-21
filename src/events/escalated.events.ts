import { UserId } from '../config/user-id-column';

export class TicketCreatedEvent {
  constructor(
    public readonly ticket: any,
    public readonly userId: UserId,
  ) {}
}

export class TicketUpdatedEvent {
  constructor(
    public readonly ticket: any,
    public readonly changes: Record<string, any>,
    public readonly userId: UserId,
  ) {}
}

export class TicketAssignedEvent {
  constructor(
    public readonly ticket: any,
    public readonly previousAssigneeId: UserId | null,
    public readonly newAssigneeId: UserId,
    public readonly userId: UserId,
  ) {}
}

export class TicketStatusChangedEvent {
  constructor(
    public readonly ticket: any,
    public readonly previousStatusId: number,
    public readonly newStatusId: number,
    public readonly userId: UserId,
    /** Follower user ids to notify (excluding the actor). See issue #74. */
    public readonly followerUserIds: UserId[] = [],
  ) {}
}

export class TicketReplyCreatedEvent {
  constructor(
    public readonly reply: any,
    public readonly ticket: any,
    public readonly userId: UserId,
    /**
     * Host-app user ids of the ticket's followers (excluding the reply author),
     * so the host can fan a notification out to them. The package abstracts the
     * user table and cannot resolve their emails itself. See issue #74.
     */
    public readonly followerUserIds: UserId[] = [],
  ) {}
}

export class TicketMergedEvent {
  constructor(
    public readonly sourceTicket: any,
    public readonly targetTicket: any,
    public readonly userId: UserId,
  ) {}
}

export class TicketSplitEvent {
  constructor(
    public readonly originalTicket: any,
    public readonly newTicket: any,
    public readonly userId: UserId,
  ) {}
}

export class SlaBreachedEvent {
  constructor(
    public readonly ticket: any,
    public readonly breachType: string,
  ) {}
}

export class TicketUnassignedEvent {
  constructor(
    public readonly ticket: any,
    public readonly previousAssigneeId: UserId | null,
    public readonly userId: UserId,
  ) {}
}

export class TicketPriorityChangedEvent {
  constructor(
    public readonly ticket: any,
    public readonly previousPriority: string,
    public readonly newPriority: string,
    public readonly userId: UserId,
  ) {}
}

export class TicketDepartmentChangedEvent {
  constructor(
    public readonly ticket: any,
    public readonly previousDepartmentId: number | null,
    public readonly newDepartmentId: number | null,
    public readonly userId: UserId,
  ) {}
}

export class TicketTagAddedEvent {
  constructor(
    public readonly ticket: any,
    public readonly tag: { id: number; name: string; slug?: string },
    public readonly userId: UserId,
  ) {}
}

export class TicketTagRemovedEvent {
  constructor(
    public readonly ticket: any,
    public readonly tag: { id: number; name: string; slug?: string },
    public readonly userId: UserId,
  ) {}
}

/** The ticket moved to the `resolved` status. */
export class TicketResolvedEvent {
  constructor(
    public readonly ticket: any,
    public readonly userId: UserId,
  ) {}
}

/** The ticket moved to a closed status other than `resolved`. */
export class TicketClosedEvent {
  constructor(
    public readonly ticket: any,
    public readonly userId: UserId,
  ) {}
}

/** The ticket moved from a resolved or closed status back to an open one. */
export class TicketReopenedEvent {
  constructor(
    public readonly ticket: any,
    public readonly userId: UserId,
  ) {}
}

/** An escalation rule matched the ticket (announced once per rule). */
export class TicketEscalatedEvent {
  constructor(
    public readonly ticket: any,
    public readonly reason: string | null = null,
  ) {}
}

/** An internal note was added to a ticket. */
export class NoteCreatedEvent {
  constructor(
    public readonly reply: any,
    public readonly ticket: any,
    public readonly userId: UserId,
  ) {}
}

/** An SLA deadline is close (announced once per deadline). */
export class SlaWarningEvent {
  constructor(
    public readonly ticket: any,
    public readonly warningType: 'first_response' | 'resolution',
    public readonly minutesRemaining: number,
  ) {}
}

/**
 * The chat session fields that leave the process (webhook payloads). The
 * visitor token hash and the visitor's email never do.
 */
export function chatSessionPayload(session: any): Record<string, any> {
  return {
    session_id: session?.id ?? null,
    ticket_id: session?.ticketId ?? null,
    status: session?.status ?? null,
    agent_id: session?.agentId ?? null,
    department_id: session?.departmentId ?? null,
  };
}

export class ChatStartedEvent {
  constructor(public readonly session: any) {}

  toJSON() {
    return { chat: chatSessionPayload(this.session) };
  }
}

export class ChatAssignedEvent {
  constructor(
    public readonly session: any,
    public readonly agentId: UserId,
  ) {}

  toJSON() {
    return { chat: { ...chatSessionPayload(this.session), agent_id: this.agentId } };
  }
}

export class ChatTransferredEvent {
  constructor(
    public readonly session: any,
    public readonly fromAgentId: UserId | null,
    public readonly toAgentId: UserId | null,
    public readonly toDepartmentId: number | null = null,
  ) {}

  toJSON() {
    return {
      chat: {
        ...chatSessionPayload(this.session),
        from_agent_id: this.fromAgentId,
        to_agent_id: this.toAgentId,
        to_department_id: this.toDepartmentId,
      },
    };
  }
}

export class ChatMessageEvent {
  constructor(
    public readonly session: any,
    public readonly reply: any,
    public readonly authorType: string = 'visitor',
  ) {}

  toJSON() {
    return {
      chat: {
        ...chatSessionPayload(this.session),
        reply_id: this.reply?.id ?? null,
        author_type: this.authorType,
      },
    };
  }
}

export class ChatEndedEvent {
  constructor(
    public readonly session: any,
    public readonly causerId?: UserId,
  ) {}

  toJSON() {
    return { chat: chatSessionPayload(this.session) };
  }
}

export class WebhookEvent {
  constructor(
    public readonly eventName: string,
    public readonly payload: Record<string, any>,
  ) {}
}

/**
 * Emitted when a public submission is created under `prompt_signup` guest
 * policy. An email listener turns this into a signup invitation email.
 */
export class TicketSignupInviteEvent {
  constructor(
    public readonly ticketId: number,
    public readonly contactId: number,
    public readonly email: string,
  ) {}
}

/**
 * Emitted when an agent triggers a host-configured custom ticket action.
 * Host applications listen for this to run their own work (CRM sync, etc.).
 */
export class TicketCustomActionTriggeredEvent {
  constructor(
    public readonly ticket: any,
    public readonly action: string,
    public readonly userId: UserId,
    public readonly payload: Record<string, any> = {},
    public readonly metadata: Record<string, any> = {},
  ) {}
}

export const ESCALATED_EVENTS = {
  TICKET_CREATED: 'escalated.ticket.created',
  TICKET_UPDATED: 'escalated.ticket.updated',
  TICKET_ASSIGNED: 'escalated.ticket.assigned',
  TICKET_UNASSIGNED: 'escalated.ticket.unassigned',
  TICKET_PRIORITY_CHANGED: 'escalated.ticket.priority_changed',
  TICKET_DEPARTMENT_CHANGED: 'escalated.ticket.department_changed',
  TICKET_TAG_ADDED: 'escalated.ticket.tag_added',
  TICKET_TAG_REMOVED: 'escalated.ticket.tag_removed',
  TICKET_RESOLVED: 'escalated.ticket.resolved',
  TICKET_CLOSED: 'escalated.ticket.closed',
  TICKET_REOPENED: 'escalated.ticket.reopened',
  TICKET_ESCALATED: 'escalated.ticket.escalated',
  TICKET_STATUS_CHANGED: 'escalated.ticket.status_changed',
  /** Every reply, internal notes included (see NOTE_CREATED). */
  TICKET_REPLY_CREATED: 'escalated.ticket.reply_created',
  NOTE_CREATED: 'escalated.note.created',
  TICKET_MERGED: 'escalated.ticket.merged',
  TICKET_SPLIT: 'escalated.ticket.split',
  SLA_BREACHED: 'escalated.sla.breached',
  SLA_WARNING: 'escalated.sla.warning',
  WEBHOOK_DISPATCH: 'escalated.webhook.dispatch',
  CHAT_STARTED: 'escalated.chat.started',
  /** @deprecated Listen to CHAT_ASSIGNED; still emitted alongside it. */
  CHAT_ACCEPTED: 'escalated.chat.accepted',
  CHAT_ASSIGNED: 'escalated.chat.assigned',
  CHAT_TRANSFERRED: 'escalated.chat.transferred',
  CHAT_MESSAGE: 'escalated.chat.message',
  CHAT_ENDED: 'escalated.chat.ended',
  SIGNUP_INVITE: 'escalated.signup.invite',
  TICKET_CUSTOM_ACTION_TRIGGERED: 'escalated.ticket.custom_action_triggered',
} as const;
