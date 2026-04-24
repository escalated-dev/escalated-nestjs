import { Injectable } from '@nestjs/common';
import type { InboundEmailParser, ParsedInboundEmail } from './inbound-parser.interface';

interface PostmarkHeader {
  Name: string;
  Value: string;
}
interface PostmarkFromFull {
  Email?: string;
  Name?: string;
}
interface PostmarkPayload {
  From?: string;
  FromName?: string;
  FromFull?: PostmarkFromFull;
  To?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: PostmarkHeader[];
}

@Injectable()
export class PostmarkInboundParser implements InboundEmailParser {
  parse(payload: unknown): ParsedInboundEmail {
    const p = (payload ?? {}) as PostmarkPayload;
    const headers = Array.isArray(p.Headers) ? p.Headers : [];

    const findHeader = (name: string): string | null => {
      const lower = name.toLowerCase();
      const hit = headers.find((h) => h?.Name?.toLowerCase() === lower);
      return hit ? hit.Value : null;
    };

    const references = (findHeader('References') ?? '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return {
      from: p.From ?? p.FromFull?.Email ?? '',
      fromName: p.FromName ?? p.FromFull?.Name ?? null,
      to: p.To ?? '',
      subject: p.Subject ?? '',
      textBody: p.TextBody ?? '',
      htmlBody: p.HtmlBody ?? null,
      messageId: findHeader('Message-ID'),
      inReplyTo: findHeader('In-Reply-To'),
      references,
    };
  }
}
