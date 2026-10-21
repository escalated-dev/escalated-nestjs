import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../entities/ticket.entity';
import { Contact } from '../entities/contact.entity';
import { Reply } from '../entities/reply.entity';
import {
  CODE_TTL_SECONDS,
  GuestAccessService,
  GuestPurpose,
  normalizeEmail,
} from './guest-access.service';

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * The guest operations the widget and guest routes share (docs/guest-access.md):
 * requesting a code, looking tickets up with one, and the ticket a grant opens.
 */
@Injectable()
export class GuestTicketsService {
  constructor(
    private readonly guestAccess: GuestAccessService,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Reply) private readonly replies: Repository<Reply>,
  ) {}

  /** `POST verification`: email a code. The answer never says whether the address is known. */
  async requestCode(body: any, clientIp: string) {
    const id = await this.guestAccess.challenge(body?.email, body?.purpose, clientIp);
    return {
      verification_id: id,
      expires_in: CODE_TTL_SECONDS,
      message: 'If the address can receive email, a verification code is on its way.',
    };
  }

  /**
   * Spend a code for `purpose` on `callback`. 422 when the proof fields are
   * missing or the code is wrong, expired or spent.
   */
  async withProof<T>(body: any, purpose: GuestPurpose, callback: () => Promise<T>): Promise<T> {
    if (!isText(body?.verification_id) || !isText(body?.verification_code)) {
      const message = 'Verify your email address: request a code and enter it.';
      throw new UnprocessableEntityException({
        message,
        errors: { verification_code: [message] },
      });
    }
    return this.guestAccess.consume(
      body.verification_id,
      body.verification_code,
      body.email,
      purpose,
      callback,
    );
  }

  /** Marks a guest ticket's email proven and hands out its first grant. */
  async grantFor(ticket: Ticket, email: string) {
    this.guestAccess.markVerified(ticket, email);
    const grant = await this.guestAccess.issue(ticket);
    return { guest_access_token: grant.token, expires_at: grant.expiresAt.toISOString() };
  }

  /**
   * `POST lookup`: the tickets with this reference whose guest email is the
   * proven one, each with a fresh grant. A reference alone opens nothing, and
   * the code is spent even when nothing matches.
   */
  async lookup(body: any) {
    const errors: Record<string, string[]> = {};
    if (!this.guestAccess.isValidEmail(body?.email))
      errors.email = ['Enter a valid email address.'];
    if (!isText(body?.reference)) errors.reference = ['Enter the ticket reference.'];
    if (Object.keys(errors).length) {
      throw new UnprocessableEntityException({ message: Object.values(errors)[0][0], errors });
    }
    const email = normalizeEmail(body.email);
    const reference = String(body.reference).trim().slice(0, 100);

    const matches = await this.withProof(body, 'lookup', async () =>
      this.tickets
        .createQueryBuilder('ticket')
        .innerJoin(Contact, 'contact', 'contact.id = ticket.contactId')
        .where('ticket.referenceNumber = :reference', { reference })
        .andWhere('LOWER(contact.email) = :email', { email })
        .orderBy('ticket.id', 'DESC')
        .take(20)
        .getMany(),
    );

    const data = [];
    for (const ticket of matches) {
      const grant = await this.grantFor(ticket, email);
      data.push({ reference: ticket.referenceNumber, subject: ticket.subject, ...grant });
    }
    return { data };
  }

  /** What a grant shows: the ticket's status and its latest public replies. */
  async status(ticket: Ticket) {
    const full = await this.tickets.findOne({
      where: { id: ticket.id },
      relations: { status: true, department: true },
    });
    const latest = await this.replies.find({
      where: { ticketId: ticket.id, isInternal: false },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 20,
    });
    const status = full?.status as { slug?: string; name?: string; color?: string } | undefined;
    return {
      reference: ticket.referenceNumber,
      subject: ticket.subject,
      status: status?.slug ?? null,
      status_label: status?.name ?? null,
      status_color: status?.color ?? null,
      created_at: ticket.createdAt ? new Date(ticket.createdAt).toISOString() : null,
      department: (full?.department as { name?: string } | undefined)?.name ?? null,
      replies: latest.reverse().map((reply) => ({
        id: reply.id,
        body: reply.body,
        is_agent: reply.userId != null && String(reply.userId) !== '0',
        created_at: reply.createdAt ? new Date(reply.createdAt).toISOString() : null,
      })),
    };
  }

  /** A guest reply's body, or 400. */
  replyBody(body: any): string {
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text) throw new BadRequestException('Write a reply.');
    return text.slice(0, 20000);
  }
}
