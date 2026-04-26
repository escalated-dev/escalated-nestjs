/**
 * Provider-agnostic shape of a parsed inbound email.
 */
export interface ParsedInboundEmail {
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
}

/**
 * Implemented per-provider (Postmark, Mailgun, SendGrid, ...).
 * Input type is `unknown` because each provider has a different schema;
 * the implementation is responsible for safely narrowing.
 */
export interface InboundEmailParser {
  parse(payload: unknown): ParsedInboundEmail;
}
