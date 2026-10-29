/**
 * How tickets, replies and the canonical events look to plugins
 * (domain-model/plugin-contract.md): snake_case, with `title` beside
 * `subject` because the SDK's `Ticket` type reads `title`.
 */

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Status id to slug, for tickets whose status relation is not loaded. */
export type StatusSlugs = ReadonlyMap<number, string>;

export function statusSlug(statuses: StatusSlugs, id: unknown): string | null {
  if (id === null || id === undefined) return null;
  return statuses.get(Number(id)) ?? null;
}

export function pluginTicket(ticket: any, statuses: StatusSlugs): Record<string, unknown> {
  return {
    id: ticket?.id ?? null,
    reference: ticket?.referenceNumber ?? ticket?.reference ?? null,
    subject: ticket?.subject ?? null,
    title: ticket?.subject ?? null,
    description: ticket?.description ?? null,
    status: ticket?.status?.slug ?? statusSlug(statuses, ticket?.statusId),
    status_id: ticket?.statusId ?? null,
    priority: ticket?.priority ?? null,
    channel: ticket?.channel ?? null,
    ticket_type: ticket?.ticketType ?? null,
    department_id: ticket?.departmentId ?? null,
    requester_id: ticket?.requesterId ?? null,
    contact_id: ticket?.contactId ?? null,
    assigned_to: ticket?.assigneeId ?? null,
    metadata: ticket?.metadata ?? null,
    tags: Array.isArray(ticket?.tags)
      ? ticket.tags.map((tag: any) => ({ id: tag.id, name: tag.name, slug: tag.slug ?? null }))
      : undefined,
    created_at: iso(ticket?.createdAt),
    updated_at: iso(ticket?.updatedAt),
  };
}

export function pluginReply(reply: any): Record<string, unknown> {
  return {
    id: reply?.id ?? null,
    ticket_id: reply?.ticketId ?? null,
    body: reply?.body ?? null,
    type: reply?.type ?? null,
    is_internal: reply?.isInternal === true,
    user_id: reply?.userId ?? null,
    created_at: iso(reply?.createdAt),
    updated_at: iso(reply?.updatedAt),
  };
}

function withTicket(ticket: any, statuses: StatusSlugs, extra: Record<string, unknown> = {}) {
  const flat = pluginTicket(ticket, statuses);
  return { ...flat, ticket: flat, ...extra };
}

/**
 * The action payload for a canonical event, from the event object this
 * package emits. Both shapes the official plugins read are there: the subject
 * flat at the top, and under its own key.
 */
export function pluginEventPayload(name: string, event: any, statuses: StatusSlugs): unknown {
  switch (name) {
    case 'ticket.status_changed':
      return withTicket(event.ticket, statuses, {
        old_status: statusSlug(statuses, event.previousStatusId),
        new_status: statusSlug(statuses, event.newStatusId),
      });
    case 'ticket.assigned':
      return withTicket(event.ticket, statuses, {
        agent_id: event.newAssigneeId ?? null,
        previous_agent_id: event.previousAssigneeId ?? null,
      });
    case 'ticket.unassigned':
      return withTicket(event.ticket, statuses, {
        previous_agent_id: event.previousAssigneeId ?? null,
      });
    case 'ticket.priority_changed':
      return withTicket(event.ticket, statuses, {
        old_priority: event.previousPriority ?? null,
        new_priority: event.newPriority ?? null,
      });
    case 'ticket.department_changed':
      return withTicket(event.ticket, statuses, {
        old_department_id: event.previousDepartmentId ?? null,
        new_department_id: event.newDepartmentId ?? null,
      });
    case 'ticket.tag_added':
    case 'ticket.tag_removed':
      return withTicket(event.ticket, statuses, {
        tag: event.tag
          ? { id: event.tag.id, name: event.tag.name, slug: event.tag.slug ?? null }
          : null,
      });
    case 'ticket.updated':
      return withTicket(event.ticket, statuses, { changes: event.changes ?? {} });
    case 'ticket.escalated':
      return withTicket(event.ticket, statuses, { reason: event.reason ?? null });
    case 'reply.created':
    case 'note.created': {
      const reply = pluginReply(event.reply);
      return { ...reply, reply, ticket: pluginTicket(event.ticket, statuses) };
    }
    case 'sla.warning':
      return withTicket(event.ticket, statuses, {
        type: event.warningType ?? null,
        minutes_remaining: event.minutesRemaining ?? null,
      });
    case 'sla.breached':
      return withTicket(event.ticket, statuses, { type: event.breachType ?? null });
    default:
      if (name.startsWith('chat.')) {
        const json = typeof event?.toJSON === 'function' ? event.toJSON() : {};
        return { session: json?.chat ?? null };
      }
      return withTicket(event.ticket, statuses);
  }
}
