import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import {
  ESCALATED_OPTIONS,
  type EscalatedModuleOptions,
} from '../../config/escalated.config';
import {
  buildMessageId,
  buildReplyTo,
} from './message-id';
import {
  renderTicketCreated,
  renderReplyPosted,
  renderSignupInvite,
  type RenderedEmail,
} from './email-templates';

interface SendTicketCreatedInput {
  to: string;
  ticket: { id: number; referenceNumber: string; subject: string; description: string };
  contact: { email: string; name: string | null };
  guestAccessToken: string;
}

interface SendReplyPostedInput {
  to: string;
  ticket: { id: number; referenceNumber: string; subject: string };
  reply: { id: number; body: string };
  contact: { email: string; name: string | null };
  guestAccessToken: string;
}

interface SendSignupInviteInput {
  to: string;
  ticket: { id: number; referenceNumber: string };
  contact: { email: string; name: string | null; id: number };
}

/**
 * High-level email dispatcher. Renders one of a small set of transactional
 * templates and hands off to MailerService. Sets Message-ID / In-Reply-To /
 * References / X-Escalated-Ticket-Id / Reply-To headers for inbound
 * threading.
 *
 * When the host app has not configured outbound mail (no `options.mail`),
 * every method is a no-op. This keeps the module bootable without a mail
 * transport — a guest will still get a ticket, just no confirmation email.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Optional() private readonly mailer: MailerService | undefined,
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  private get mailConfigured(): boolean {
    return !!(this.mailer && this.options.mail);
  }

  private appName(): string {
    return this.options.appName ?? 'Support';
  }

  private inboundDomain(): string | null {
    return this.options.inbound?.replyDomain ?? null;
  }

  private inboundSecret(): string | null {
    return this.options.inbound?.replySecret ?? null;
  }

  private threadingHeaders(
    ticketId: number,
    replyId: number | null,
    inReplyToMessageId?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Escalated-Ticket-Id': String(ticketId),
    };
    const domain = this.inboundDomain();
    if (domain) {
      headers['Message-ID'] = buildMessageId(ticketId, replyId, domain);
    }
    if (inReplyToMessageId) {
      headers['In-Reply-To'] = inReplyToMessageId;
      headers['References'] = inReplyToMessageId;
    }
    return headers;
  }

  private replyToFor(ticketId: number): string | undefined {
    const domain = this.inboundDomain();
    const secret = this.inboundSecret();
    if (!domain || !secret) return undefined;
    return buildReplyTo(ticketId, secret, domain);
  }

  private async dispatch(
    to: string,
    rendered: RenderedEmail,
    headers: Record<string, string>,
    replyTo?: string,
  ): Promise<void> {
    if (!this.mailConfigured || !this.mailer || !this.options.mail) return;
    await this.mailer.sendMail({
      to,
      from: this.options.mail.from,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers,
      replyTo,
    });
  }

  async sendTicketCreated(input: SendTicketCreatedInput): Promise<void> {
    if (!this.mailConfigured) return;
    const rendered = renderTicketCreated({
      ticket: input.ticket,
      contact: input.contact,
      appName: this.appName(),
      appUrl: this.options.appUrl,
      guestAccessToken: input.guestAccessToken,
    });
    const headers = this.threadingHeaders(input.ticket.id, null);
    const replyTo = this.replyToFor(input.ticket.id);
    await this.dispatch(input.to, rendered, headers, replyTo);
  }

  async sendReplyPosted(input: SendReplyPostedInput): Promise<void> {
    if (!this.mailConfigured) return;
    const rendered = renderReplyPosted({
      ticket: input.ticket,
      reply: input.reply,
      contact: input.contact,
      appName: this.appName(),
      appUrl: this.options.appUrl,
      guestAccessToken: input.guestAccessToken,
    });
    const domain = this.inboundDomain();
    const inReplyTo = domain ? buildMessageId(input.ticket.id, null, domain) : undefined;
    const headers = this.threadingHeaders(input.ticket.id, input.reply.id, inReplyTo);
    const replyTo = this.replyToFor(input.ticket.id);
    await this.dispatch(input.to, rendered, headers, replyTo);
  }

  async sendSignupInvite(input: SendSignupInviteInput): Promise<void> {
    if (!this.mailConfigured) return;
    const policy = this.options.guestPolicy;
    if (!policy || policy.mode !== 'prompt_signup' || !policy.signupUrlTemplate) {
      this.logger.debug(
        'signup invite skipped: policy not prompt_signup or no template configured',
      );
      return;
    }
    // Signup token = the ticket's guestAccessToken scoped to the contact's
    // HMAC. The host app verifies and links on account creation.
    const secret = this.inboundSecret() ?? 'escalated-signup';
    const token = buildReplyTo(input.contact.id, secret, 'signup').split('@')[0];
    const signupUrl = policy.signupUrlTemplate.replace(
      '{token}',
      encodeURIComponent(token),
    );

    const rendered = renderSignupInvite({
      ticket: input.ticket,
      contact: input.contact,
      appName: this.appName(),
      signupUrl,
    });
    const headers = this.threadingHeaders(input.ticket.id, null);
    await this.dispatch(input.to, rendered, headers);
  }
}
