import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { ContactService } from '../contact.service';
import { ReplyService } from '../reply.service';
import { TicketService } from '../ticket.service';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import type { ParsedInboundEmail } from './inbound-parser.interface';
import { parseTicketIdFromMessageId, verifyReplyTo } from './message-id';

export interface InboundRouteResult {
  outcome: 'reply_added' | 'ticket_created' | 'ignored' | 'error';
  matchedTicketId?: number;
  createdTicketId?: number;
  createdReplyId?: number;
  error?: string;
}

/**
 * Takes a parsed inbound email and routes it to the right place:
 *
 *   1. In-Reply-To / References match a Message-ID we issued → add reply.
 *   2. Envelope `to` matches our signed reply-to pattern → add reply.
 *   3. Subject contains a `[TK-XXX]` reference number → add reply.
 *   4. Otherwise, resolve/create a Contact by sender and create a new ticket.
 *
 * Malformed (no `from` address) → ignored.
 */
@Injectable()
export class InboundRouterService {
  private readonly logger = new Logger(InboundRouterService.name);

  constructor(
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
    private readonly contactService: ContactService,
    private readonly replyService: ReplyService,
    private readonly ticketService: TicketService,
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  async route(parsed: ParsedInboundEmail): Promise<InboundRouteResult> {
    if (!parsed.from) {
      return { outcome: 'ignored' };
    }

    const ticketId = await this.resolveTicket(parsed);
    if (ticketId !== null) {
      return this.addReply(ticketId, parsed);
    }
    return this.createTicket(parsed);
  }

  private async resolveTicket(parsed: ParsedInboundEmail): Promise<number | null> {
    // Priority 1: In-Reply-To header points at a Message-ID we issued
    const byInReplyTo = parseTicketIdFromMessageId(parsed.inReplyTo);
    if (byInReplyTo !== null) {
      const hit = await this.ticketRepo.findOne({ where: { id: byInReplyTo } });
      if (hit) return hit.id;
    }

    // Priority 1b: References header (chain)
    for (const ref of parsed.references ?? []) {
      const byRef = parseTicketIdFromMessageId(ref);
      if (byRef !== null) {
        const hit = await this.ticketRepo.findOne({ where: { id: byRef } });
        if (hit) return hit.id;
      }
    }

    // Priority 2: signed reply-to envelope
    const secret = this.options.inbound?.replySecret;
    if (secret && parsed.to) {
      const verified = verifyReplyTo(parsed.to, secret);
      if (verified.ok) {
        const hit = await this.ticketRepo.findOne({ where: { id: verified.ticketId } });
        if (hit) return hit.id;
      }
    }

    // Priority 3: subject reference number, e.g. "Re: [TK-ABC123] ..."
    const refMatch = parsed.subject.match(/\[(TK-[A-Z0-9-]+)\]/i);
    if (refMatch) {
      const referenceNumber = refMatch[1].toUpperCase();
      const hit = await this.ticketRepo.findOne({ where: { referenceNumber } });
      if (hit) return hit.id;
    }

    return null;
  }

  private async addReply(
    ticketId: number,
    parsed: ParsedInboundEmail,
  ): Promise<InboundRouteResult> {
    try {
      // Ensure sender has a Contact on file (doesn't have to match the
      // ticket's original contactId — threaded replies from forwarded
      // addresses are allowed).
      await this.contactService.findOrCreateByEmail(parsed.from, parsed.fromName);

      const reply = await this.replyService.create(
        ticketId,
        { body: parsed.textBody, type: 'reply' },
        0,
      );
      return {
        outcome: 'reply_added',
        matchedTicketId: ticketId,
        createdReplyId: reply.id,
      };
    } catch (err) {
      this.logger.error(`inbound reply on ticket #${ticketId} failed: ${this.msg(err)}`);
      return { outcome: 'error', matchedTicketId: ticketId, error: this.msg(err) };
    }
  }

  private async createTicket(parsed: ParsedInboundEmail): Promise<InboundRouteResult> {
    try {
      const contact = await this.contactService.findOrCreateByEmail(parsed.from, parsed.fromName);
      const ticket = await this.ticketService.create(
        {
          subject: parsed.subject || '(no subject)',
          description: parsed.textBody,
          channel: 'email',
          contactId: contact.id,
        },
        0,
      );
      return { outcome: 'ticket_created', createdTicketId: ticket.id };
    } catch (err) {
      this.logger.error(`inbound new-ticket creation failed: ${this.msg(err)}`);
      return { outcome: 'error', error: this.msg(err) };
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
