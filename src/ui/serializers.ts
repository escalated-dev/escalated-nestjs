import type { UserId } from '../config/user-id-column';
import { statusCategory } from '../entities/status-category';
import type { Attachment } from '../entities/attachment.entity';
import type { Reply } from '../entities/reply.entity';
import type { Ticket } from '../entities/ticket.entity';
import type { TicketActivity } from '../entities/ticket-activity.entity';
import type { EscalatedUiUser } from './ui-options';

/**
 * The shapes the shared screens read, which are escalated-laravel's (snake
 * case, `reference`, `status` as a slug, `requester` / `assignee` objects),
 * built from this package's entities.
 */

export type UserDirectory = Map<string, EscalatedUiUser>;

export function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function person(
  directory: UserDirectory,
  id: UserId | null | undefined,
): { id: UserId; name: string; email: string | null } | null {
  if (id == null || id === '' || String(id) === '0') return null;
  const user = directory.get(String(id));
  return { id, name: user?.name || `User #${id}`, email: user?.email ?? null };
}

export function serializeAttachment(attachment: Attachment) {
  return {
    id: attachment.id,
    original_filename: attachment.fileName,
    filename: attachment.fileName,
    mime_type: attachment.mimeType,
    size: attachment.fileSize,
    url: attachment.url ?? `/escalated/attachments/${attachment.id}/download`,
    created_at: iso(attachment.createdAt),
  };
}

export function serializeReply(reply: Reply, directory: UserDirectory) {
  return {
    id: reply.id,
    ticket_id: reply.ticketId,
    body: reply.body,
    type: reply.type,
    is_internal_note: reply.isInternal === true,
    is_pinned: false,
    author_id: reply.userId ?? null,
    author: person(directory, reply.userId),
    attachments: (reply.attachments ?? []).map(serializeAttachment),
    created_at: iso(reply.createdAt),
    updated_at: iso(reply.updatedAt),
  };
}

export function serializeActivity(activity: TicketActivity, directory: UserDirectory) {
  return {
    id: activity.id,
    type: activity.action,
    description: activity.description,
    properties: { old: activity.oldValue ?? null, new: activity.newValue ?? null },
    causer: person(directory, activity.userId),
    created_at: iso(activity.createdAt),
  };
}

export interface TicketExtras {
  latestReply?: Reply | null;
  contact?: { name: string | null; email: string } | null;
}

/** A ticket as the lists and the ticket screens read it. */
export function serializeTicket(
  ticket: Ticket,
  directory: UserDirectory,
  extras: TicketExtras = {},
) {
  const requester = person(directory, ticket.requesterId);
  const requesterName =
    extras.contact?.name ||
    directory.get(String(ticket.requesterId))?.name ||
    ticket.requester_name;
  const requesterEmail =
    extras.contact?.email ||
    directory.get(String(ticket.requesterId))?.email ||
    ticket.requester_email ||
    null;

  return {
    id: ticket.id,
    reference: ticket.referenceNumber,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status?.slug ?? null,
    status_label: ticket.status?.name ?? null,
    status_id: ticket.statusId ?? null,
    status_category: ticket.status ? statusCategory(ticket.status) : null,
    // A status an admin added (not a built-in one), for the shared StatusBadge.
    custom_status:
      ticket.status && !ticket.status.isSystem
        ? {
            id: ticket.status.id,
            label: ticket.status.name,
            slug: ticket.status.slug,
            color: ticket.status.color ?? null,
            category: statusCategory(ticket.status),
          }
        : null,
    priority: ticket.priority,
    channel: ticket.channel,
    ticket_type: ticket.ticketType,
    department_id: ticket.departmentId ?? null,
    department: ticket.department
      ? { id: ticket.department.id, name: ticket.department.name }
      : null,
    requester_id: ticket.requesterId,
    requester: {
      id: ticket.requesterId,
      name: requesterName || requester?.name || 'Guest',
      email: requesterEmail,
    },
    requester_name: requesterName || requester?.name || 'Guest',
    requester_email: requesterEmail,
    assigned_to: ticket.assigneeId ?? null,
    assignee: person(directory, ticket.assigneeId),
    tags: (ticket.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    sla_first_response_breached: ticket.slaFirstResponseBreached === true,
    sla_resolution_breached: ticket.slaResolutionBreached === true,
    first_response_due_at: iso(ticket.firstResponseDueAt),
    resolution_due_at: iso(ticket.resolutionDueAt),
    first_response_at: iso(ticket.firstRespondedAt),
    resolved_at: iso(ticket.resolvedAt),
    closed_at: iso(ticket.closedAt),
    snoozed_until: iso(ticket.snoozedUntil),
    last_reply_at: iso(ticket.last_reply_at),
    last_reply_author: ticket.last_reply_author ?? null,
    latest_reply: extras.latestReply ? serializeReply(extras.latestReply, directory) : null,
    created_at: iso(ticket.createdAt),
    updated_at: iso(ticket.updatedAt),
  };
}

/** A Laravel length-aware paginator, which the list components read. */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number,
  path: string,
  query: Record<string, unknown> = {},
) {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const url = (n: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key !== 'page' && value != null && value !== '' && typeof value !== 'object') {
        params.set(key, String(value));
      }
    }
    params.set('page', String(n));
    return `${path}?${params.toString()}`;
  };
  const from = total === 0 ? null : (page - 1) * perPage + 1;
  return {
    data,
    current_page: page,
    last_page: lastPage,
    per_page: perPage,
    total,
    from,
    to: from == null ? null : from + data.length - 1,
    path,
    first_page_url: url(1),
    last_page_url: url(lastPage),
    prev_page_url: page > 1 ? url(page - 1) : null,
    next_page_url: page < lastPage ? url(page + 1) : null,
    links: [
      { url: page > 1 ? url(page - 1) : null, label: '&laquo; Previous', active: false },
      // A window around the current page, as Laravel's paginator links show.
      ...Array.from({ length: lastPage }, (_, i) => i + 1)
        .filter((n) => n === 1 || n === lastPage || Math.abs(n - page) <= 3)
        .map((n) => ({ url: url(n), label: String(n), active: n === page })),
      { url: page < lastPage ? url(page + 1) : null, label: 'Next &raquo;', active: false },
    ],
  };
}
