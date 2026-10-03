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
 * Takes a parsed inbound email and routes it to the right place.
 *
 * Finding the ticket:
 *
 *   - With `inbound.replySecret` configured (outbound mail then carries the
 *     signed reply-to), only the signed envelope `to` address identifies a
 *     ticket. Message-IDs and reference numbers are guessable, so they are
 *     not trusted once a secret exists.
 *   - Without a secret: In-Reply-To / References matching a Message-ID we
 *     issued, then a `[TK-XXX]` subject reference.
 *
 * Accepting the reply: a matched email is added as a reply only when the
 * sender is the ticket's requester (the ticket's Contact, or a Contact
 * linked to the requester user), compared case-insensitively. It is posted
 * as that requester, never as an identity taken from the From header.
 * Anything else, including a sender who is not the requester, resolves or
 * creates a Contact and opens a new ticket, so mail is never dropped.
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

    const ticket = await this.resolveTicket(parsed);
    if (ticket && (await this.isFromRequester(ticket, parsed.from))) {
      return this.addReply(ticket, parsed);
    }
    if (ticket) {
      this.logger.log(
        `inbound email matched ticket #${ticket.id} but not its requester; opening a new ticket`,
      );
    }
    return this.createTicket(parsed);
  }

  /**
   * True when `from` is the ticket's requester: the Contact on the ticket,
   * or a Contact linked to the requester user. Emails are compared
   * normalized (trimmed, lower-cased) by ContactService.
   */
  private async isFromRequester(ticket: Ticket, from: string): Promise<boolean> {
    const sender = await this.contactService.findByEmail(from);
    if (!sender) return false;

    if (ticket.contactId !== null && ticket.contactId !== undefined) {
      if (sender.id === ticket.contactId) return true;
    }

    return (
      sender.userId !== null &&
      sender.userId !== undefined &&
      ticket.requesterId !== null &&
      ticket.requesterId !== undefined &&
      String(sender.userId) === String(ticket.requesterId)
    );
  }

  private async resolveTicket(parsed: ParsedInboundEmail): Promise<Ticket | null> {
    // With a reply secret, only the signed reply-to envelope counts.
    const secret = this.options.inbound?.replySecret;
    if (secret) {
      if (!parsed.to) return null;
      const verified = verifyReplyTo(parsed.to, secret);
      if (!verified.ok) return null;
      return this.ticketRepo.findOne({ where: { id: verified.ticketId } });
    }

    // In-Reply-To header points at a Message-ID we issued
    const byInReplyTo = parseTicketIdFromMessageId(parsed.inReplyTo);
    if (byInReplyTo !== null) {
      const hit = await this.ticketRepo.findOne({ where: { id: byInReplyTo } });
      if (hit) return hit;
    }

    // References header (chain)
    for (const ref of parsed.references ?? []) {
      const byRef = parseTicketIdFromMessageId(ref);
      if (byRef !== null) {
        const hit = await this.ticketRepo.findOne({ where: { id: byRef } });
        if (hit) return hit;
      }
    }

    // Subject reference number, e.g. "Re: [TK-ABC123] ..."
    const refMatch = parsed.subject.match(/\[(TK-[A-Z0-9-]+)\]/i);
    if (refMatch) {
      const referenceNumber = refMatch[1].toUpperCase();
      const hit = await this.ticketRepo.findOne({ where: { referenceNumber } });
      if (hit) return hit;
    }

    return null;
  }

  private async addReply(ticket: Ticket, parsed: ParsedInboundEmail): Promise<InboundRouteResult> {
    const ticketId = ticket.id;
    try {
      // Post as the ticket's requester: the sender has already been checked
      // against the ticket, and the From header is never used as identity.
      const reply = await this.replyService.create(
        ticketId,
        { body: parsed.textBody, type: 'reply' },
        ticket.requesterId,
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
