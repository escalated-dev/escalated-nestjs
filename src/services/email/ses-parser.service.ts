import { Injectable } from '@nestjs/common';
import type { InboundEmailParser, ParsedInboundEmail } from './inbound-parser.interface';

interface SNSEnvelope {
  Type?: string;
  TopicArn?: string;
  SubscribeURL?: string;
  Token?: string;
  Message?: string;
}

interface SESMail {
  source?: string;
  destination?: string[];
  headers?: Array<{ name?: string; value?: string }>;
  commonHeaders?: {
    from?: string[];
    to?: string[];
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
  };
}

interface SESNotification {
  notificationType?: string;
  mail?: SESMail;
  content?: string;
}

/**
 * Thrown when the webhook receives an SNS subscription-confirmation
 * envelope. The host app must GET {@link subscribeUrl} out-of-band
 * to activate the subscription; the controller can catch this
 * sentinel error and short-circuit to a 202 Accepted so AWS stops
 * retrying the confirmation POST.
 */
export class SESSubscriptionConfirmationError extends Error {
  constructor(
    public readonly topicArn: string,
    public readonly subscribeUrl: string,
    public readonly token: string,
  ) {
    super(`SES subscription confirmation for topic ${topicArn}; GET ${subscribeUrl} to confirm.`);
    this.name = 'SESSubscriptionConfirmationError';
  }
}

/**
 * Parses AWS SES inbound mail delivered via SNS HTTP subscription.
 * SES receipt rules publish to an SNS topic; host apps subscribe via
 * HTTP and SNS POSTs the envelope to
 * {@code POST /escalated/webhook/email/inbound} when
 * {@code options.inbound.provider} is {@code 'ses'}.
 *
 * Handles two envelope types:
 *   - {@code Type=SubscriptionConfirmation} — throws
 *     {@link SESSubscriptionConfirmationError}.
 *   - {@code Type=Notification} — parses the JSON-encoded
 *     {@code Message} field for {@code mail.commonHeaders} and the
 *     {@code mail.headers} array.
 *
 * Body extraction from the base64-encoded {@code content} field is
 * best-effort: plain single-part text/plain + text/html and
 * multipart/alternative bodies are decoded. Missing content leaves
 * {@code textBody} empty; the router still resolves via threading
 * metadata so matched replies work regardless.
 */
@Injectable()
export class SESInboundParser implements InboundEmailParser {
  parse(payload: unknown): ParsedInboundEmail {
    const envelope = (payload ?? {}) as SNSEnvelope;

    switch (envelope.Type) {
      case 'SubscriptionConfirmation':
        throw new SESSubscriptionConfirmationError(
          envelope.TopicArn ?? '',
          envelope.SubscribeURL ?? '',
          envelope.Token ?? '',
        );
      case 'Notification':
        break;
      default:
        throw new Error(`Unsupported SNS envelope type: "${envelope.Type ?? ''}"`);
    }

    const messageJson = envelope.Message ?? '';
    if (!messageJson) {
      throw new Error('SES notification has no Message body');
    }

    let notification: SESNotification;
    try {
      notification = JSON.parse(messageJson) as SESNotification;
    } catch (err) {
      throw new Error(`SES notification Message is not valid JSON: ${(err as Error).message}`);
    }

    const mail = notification.mail ?? {};
    const common = mail.commonHeaders ?? {};

    const [fromEmail, fromName] = parseFirstAddressList(common.from);
    const [toEmail] = parseFirstAddressList(common.to);

    const headers = extractHeaders(mail.headers ?? []);
    const messageId = common.messageId ?? headers['Message-ID'] ?? null;
    const inReplyTo = common.inReplyTo ?? headers['In-Reply-To'] ?? null;
    const referencesRaw = common.references ?? headers['References'] ?? '';
    const references = referencesRaw
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const { text, html } = extractBody(notification.content ?? '');

    return {
      from: fromEmail,
      fromName,
      to: toEmail,
      subject: common.subject ?? '',
      textBody: text ?? '',
      htmlBody: html,
      messageId,
      inReplyTo,
      references,
    };
  }
}

/**
 * SES's {@code commonHeaders.from} / {@code .to} are arrays of RFC
 * 5322 strings (e.g. {@code ["Alice <alice@example.com>"]}). Returns
 * the first usable entry's [email, display-name-or-null].
 */
function parseFirstAddressList(list: string[] | undefined): [string, string | null] {
  if (!list || list.length === 0) return ['', null];
  const raw = (list[0] ?? '').trim();
  if (!raw) return ['', null];

  const match = raw.match(/^\s*(?:"?([^<"]*?)"?\s*)?<([^>]+)>\s*$/);
  if (match) {
    const [, name, email] = match;
    const trimmedName = (name ?? '').trim();
    return [email.trim(), trimmedName.length > 0 ? trimmedName : null];
  }
  return [raw, null];
}

function extractHeaders(entries: Array<{ name?: string; value?: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (typeof entry.name === 'string' && typeof entry.value === 'string' && entry.name) {
      out[entry.name] = entry.value;
    }
  }
  return out;
}

/**
 * Decode the base64 {@code content} field and extract text/plain +
 * text/html parts. Minimal hand-rolled MIME splitter — no external
 * dep — handles plain single-part bodies, multipart/alternative, and
 * quoted-printable + base64 transfer encoding. Returns
 * {@code { text: null, html: null }} when the field is absent,
 * malformed, or the MIME parse fails.
 */
function extractBody(contentB64: string): { text: string | null; html: string | null } {
  if (!contentB64) return { text: null, html: null };

  let raw: string;
  try {
    raw = Buffer.from(contentB64, 'base64').toString('utf-8');
  } catch {
    return { text: null, html: null };
  }

  const split = splitHeadersAndBody(raw);
  if (!split) return { text: null, html: null };
  const { headers, body } = split;

  const contentType = headers['content-type'] ?? 'text/plain';
  const transferEnc = headers['content-transfer-encoding'] ?? '7bit';
  const ct = contentType.toLowerCase();

  if (ct.startsWith('multipart/')) {
    return walkMultipart(body, contentType);
  }
  const decoded = decodeBody(body, transferEnc);
  if (ct.startsWith('text/html')) {
    return { text: null, html: decoded };
  }
  return { text: decoded, html: null };
}

function splitHeadersAndBody(
  raw: string,
): { headers: Record<string, string>; body: string } | null {
  let idx = raw.indexOf('\r\n\r\n');
  let skip = 4;
  if (idx === -1) {
    idx = raw.indexOf('\n\n');
    skip = 2;
  }
  if (idx === -1) return null;

  const headerBlock = raw.substring(0, idx);
  const body = raw.substring(idx + skip);

  const headers: Record<string, string> = {};
  for (const line of headerBlock.split(/\r?\n/)) {
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.substring(0, colon).trim().toLowerCase();
    const value = line.substring(colon + 1).trim();
    headers[name] = value;
  }
  return { headers, body };
}

function walkMultipart(
  body: string,
  contentType: string,
): { text: string | null; html: string | null } {
  const match = contentType.match(/boundary\s*=\s*"?([^";\s]+)"?/i);
  if (!match) return { text: null, html: null };

  const boundary = match[1];
  const delimiter = '--' + boundary;
  const parts = body.split(delimiter).slice(1);

  let text: string | null = null;
  let html: string | null = null;

  for (const part of parts) {
    const trimmed = part.replace(/^[\r\n]+/, '');
    if (!trimmed || trimmed.startsWith('--')) continue;

    const partSplit = splitHeadersAndBody(trimmed);
    if (!partSplit) continue;

    const partType = (partSplit.headers['content-type'] ?? '').toLowerCase();
    const partEnc = partSplit.headers['content-transfer-encoding'] ?? '7bit';
    const decoded = decodeBody(partSplit.body.replace(/[\r\n]+$/, ''), partEnc);

    if (partType.startsWith('text/plain') && text === null) {
      text = decoded;
    } else if (partType.startsWith('text/html') && html === null) {
      html = decoded;
    }
  }
  return { text, html };
}

function decodeBody(body: string, transferEnc: string): string {
  const enc = transferEnc.trim().toLowerCase();
  if (enc === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }
  if (enc === 'base64') {
    try {
      return Buffer.from(body, 'base64').toString('utf-8');
    } catch {
      return body;
    }
  }
  return body;
}

function decodeQuotedPrintable(body: string): string {
  return body
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
