import { createHmac } from 'crypto';

/**
 * Build an RFC 5322 Message-ID for outbound email. Format:
 *   <ticket-{ticketId}@{domain}>           — initial ticket email
 *   <ticket-{ticketId}-reply-{replyId}@{domain}> — agent reply
 *
 * Parsed back by parseTicketIdFromMessageId to resolve inbound replies.
 */
export function buildMessageId(
  ticketId: number,
  replyId: number | null | undefined,
  domain: string,
): string {
  const body =
    typeof replyId === 'number' && Number.isFinite(replyId)
      ? `ticket-${ticketId}-reply-${replyId}`
      : `ticket-${ticketId}`;
  return `<${body}@${domain}>`;
}

/**
 * Extract the ticket id from a message id we issued, or null if none.
 * Accepts the header value with or without the angle brackets.
 */
export function parseTicketIdFromMessageId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/ticket-(\d+)(?:-reply-\d+)?@/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function sign(ticketId: number, secret: string): string {
  return createHmac('sha256', secret).update(String(ticketId)).digest('hex').slice(0, 8);
}

/**
 * Build a signed Reply-To address of the form:
 *   reply+{ticketId}.{hmac8}@{domain}
 *
 * Inbound provider webhook verifies the signature before routing the reply
 * to the ticket. Surviving-through-threading concern: even when clients
 * strip our Message-ID / In-Reply-To headers, the Reply-To address still
 * carries the identity.
 */
export function buildReplyTo(ticketId: number, secret: string, domain: string): string {
  return `reply+${ticketId}.${sign(ticketId, secret)}@${domain}`;
}

/**
 * Verify a reply-to local part. Returns `{ ok: true, ticketId }` on match,
 * `{ ok: false }` otherwise.
 */
export function verifyReplyTo(
  address: string,
  secret: string,
): { ok: true; ticketId: number } | { ok: false } {
  const at = address.indexOf('@');
  if (at <= 0) return { ok: false };
  const local = address.slice(0, at);
  const match = local.match(/^reply\+(\d+)\.([a-f0-9]{8})$/i);
  if (!match) return { ok: false };
  const ticketId = Number(match[1]);
  if (!Number.isFinite(ticketId)) return { ok: false };
  const expected = sign(ticketId, secret);
  if (match[2].toLowerCase() !== expected.toLowerCase()) return { ok: false };
  return { ok: true, ticketId };
}
