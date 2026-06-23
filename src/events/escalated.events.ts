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
  TICKET_STATUS_CHANGED: 'escalated.ticket.status_changed',
  TICKET_REPLY_CREATED: 'escalated.ticket.reply_created',
  TICKET_MERGED: 'escalated.ticket.merged',
  TICKET_SPLIT: 'escalated.ticket.split',
  SLA_BREACHED: 'escalated.sla.breached',
  WEBHOOK_DISPATCH: 'escalated.webhook.dispatch',
  CHAT_STARTED: 'escalated.chat.started',
  CHAT_ACCEPTED: 'escalated.chat.accepted',
  CHAT_MESSAGE: 'escalated.chat.message',
  CHAT_ENDED: 'escalated.chat.ended',
  SIGNUP_INVITE: 'escalated.signup.invite',
  TICKET_CUSTOM_ACTION_TRIGGERED: 'escalated.ticket.custom_action_triggered',
} as const;
