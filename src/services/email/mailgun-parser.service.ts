import { Injectable } from '@nestjs/common';
import type { InboundEmailParser, ParsedInboundEmail } from './inbound-parser.interface';

interface MailgunPayload {
  sender?: string;
  from?: string;
  recipient?: string;
  To?: string;
  subject?: string;
  'body-plain'?: string;
  'body-html'?: string;
  'Message-Id'?: string;
  'In-Reply-To'?: string;
  References?: string;
}

/**
 * Parses Mailgun's inbound webhook payload into a
 * {@link ParsedInboundEmail}. Mailgun posts a flat form-encoded body
 * (which Nest normalizes to a plain object) with lower-cased field
 * names plus a few canonical-cased headers: {@code sender} / {@code from}
 * / {@code recipient} / {@code subject} / {@code body-plain} /
 * {@code body-html} / {@code Message-Id} / {@code In-Reply-To} /
 * {@code References}.
 *
 * Selected by `options.inbound.provider: 'mailgun'` in the host app's
 * module config. The controller picks this parser or
 * {@link PostmarkInboundParser} based on the configured value.
 */
@Injectable()
export class MailgunInboundParser implements InboundEmailParser {
  parse(payload: unknown): ParsedInboundEmail {
    const p = (payload ?? {}) as MailgunPayload;

    const references = (p.References ?? '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const fromRaw = p.from ?? '';
    const fromEmail = p.sender ?? extractEmail(fromRaw) ?? fromRaw;
    const fromName = extractDisplayName(fromRaw);

    return {
      from: fromEmail,
      fromName,
      to: p.recipient ?? p.To ?? '',
      subject: p.subject ?? '',
      textBody: p['body-plain'] ?? '',
      htmlBody: p['body-html'] ?? null,
      messageId: p['Message-Id'] ?? null,
      inReplyTo: p['In-Reply-To'] ?? null,
      references,
    };
  }
}

/**
 * Mailgun's `from` is typically `"Display Name <email@host>"`; strip
 * the display name and return just the email portion. Falls back to
 * null when the value has no angle-bracketed email.
 */
function extractEmail(raw: string): string | null {
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1].trim() : null;
}

/**
 * Extract the display name from `"Display Name <email@host>"`.
 * Returns null when there's no display name or no angle-bracketed
 * email.
 */
function extractDisplayName(raw: string): string | null {
  if (!raw || !raw.includes('<')) return null;
  const name = raw.substring(0, raw.indexOf('<')).trim().replace(/^"|"$/g, '');
  return name.length > 0 ? name : null;
}
