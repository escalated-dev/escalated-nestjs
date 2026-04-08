export class TicketCreatedEvent {
  constructor(
    public readonly ticket: any,
    public readonly userId: number,
  ) {}
}

export class TicketUpdatedEvent {
  constructor(
    public readonly ticket: any,
    public readonly changes: Record<string, any>,
    public readonly userId: number,
  ) {}
}

export class TicketAssignedEvent {
  constructor(
    public readonly ticket: any,
    public readonly previousAssigneeId: number | null,
    public readonly newAssigneeId: number,
    public readonly userId: number,
  ) {}
}

export class TicketStatusChangedEvent {
  constructor(
    public readonly ticket: any,
    public readonly previousStatusId: number,
    public readonly newStatusId: number,
    public readonly userId: number,
  ) {}
}

export class TicketReplyCreatedEvent {
  constructor(
    public readonly reply: any,
    public readonly ticket: any,
    public readonly userId: number,
  ) {}
}

export class TicketMergedEvent {
  constructor(
    public readonly sourceTicket: any,
    public readonly targetTicket: any,
    public readonly userId: number,
  ) {}
}

export class TicketSplitEvent {
  constructor(
    public readonly originalTicket: any,
    public readonly newTicket: any,
    public readonly userId: number,
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
} as const;
