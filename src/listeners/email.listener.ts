import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../services/email/email.service';
import { ContactService } from '../services/contact.service';
import {
  ESCALATED_EVENTS,
  TicketCreatedEvent,
  TicketReplyCreatedEvent,
  TicketSignupInviteEvent,
} from '../events/escalated.events';

/**
 * Translates application events into outbound email dispatches.
 *
 * Errors from EmailService are logged and swallowed — a mail outage must
 * never prevent ticket creation or reply posting.
 */
@Injectable()
export class EmailListener {
  private readonly logger = new Logger(EmailListener.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly contactService: ContactService,
  ) {}

  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  async onTicketCreated(event: TicketCreatedEvent): Promise<void> {
    const ticket = event.ticket as {
      id: number;
      referenceNumber: string;
      subject: string;
      description: string;
      contactId: number | null;
      guestAccessToken: string;
    };
    if (!ticket.contactId) return;

    try {
      const contact = await this.contactService.findById(ticket.contactId);
      if (!contact) return;
      await this.emailService.sendTicketCreated({
        to: contact.email,
        ticket: {
          id: ticket.id,
          referenceNumber: ticket.referenceNumber,
          subject: ticket.subject,
          description: ticket.description,
        },
        contact: { email: contact.email, name: contact.name },
        guestAccessToken: ticket.guestAccessToken,
      });
    } catch (err) {
      this.logger.warn(
        `ticket.created email failed for ticket #${ticket.id}: ${this.msg(err)}`,
      );
    }
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_REPLY_CREATED)
  async onReplyCreated(event: TicketReplyCreatedEvent): Promise<void> {
    const reply = event.reply as {
      id: number;
      body: string;
      isInternal?: boolean;
      type?: string;
    };
    const ticket = event.ticket as {
      id: number;
      referenceNumber: string;
      subject: string;
      contactId: number | null;
      guestAccessToken: string;
    };

    if (reply.isInternal || reply.type === 'note') return;
    if (!ticket.contactId) return;

    try {
      const contact = await this.contactService.findById(ticket.contactId);
      if (!contact) return;
      await this.emailService.sendReplyPosted({
        to: contact.email,
        ticket: {
          id: ticket.id,
          referenceNumber: ticket.referenceNumber,
          subject: ticket.subject,
        },
        reply: { id: reply.id, body: reply.body },
        contact: { email: contact.email, name: contact.name },
        guestAccessToken: ticket.guestAccessToken,
      });
    } catch (err) {
      this.logger.warn(
        `reply.created email failed for ticket #${ticket.id}: ${this.msg(err)}`,
      );
    }
  }

  @OnEvent(ESCALATED_EVENTS.SIGNUP_INVITE)
  async onSignupInvite(event: TicketSignupInviteEvent): Promise<void> {
    try {
      const contact = await this.contactService.findById(event.contactId);
      if (!contact) return;
      await this.emailService.sendSignupInvite({
        to: event.email,
        ticket: { id: event.ticketId, referenceNumber: `TK-${event.ticketId}` },
        contact: { email: contact.email, name: contact.name, id: contact.id },
      });
    } catch (err) {
      this.logger.warn(
        `signup.invite email failed for contact #${event.contactId}: ${this.msg(err)}`,
      );
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
