import {
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { In, Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { Ticket } from '../entities/ticket.entity';
import { Reply } from '../entities/reply.entity';
import { Contact } from '../entities/contact.entity';
import { AgentProfile } from '../entities/agent-profile.entity';
import { ESCALATED_EVENTS, TicketSignupInviteEvent } from '../events/escalated.events';
import { GuestAccessService, GuestGrant, normalizeEmail } from './guest-access.service';
import { GuestTicketsService } from './guest-tickets.service';
import { TicketService } from './ticket.service';
import { ReplyService } from './reply.service';
import { ContactService } from './contact.service';
import { DepartmentService } from './department.service';
import { SettingsService } from './settings.service';
import { requesterIdForPolicy, resolveGuestPolicy } from './guest-policy';
import { widgetDepartmentId } from '../controllers/widget/widget-input';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = ['low', 'medium', 'high', 'urgent', 'critical'] as const;
const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
  critical: 'Critical',
};
const MAX_TEXT = 65535;

type Errors = Record<string, string[]>;

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

const label = (value: string) =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** A required string of at most `max` characters, trimmed; else an error. */
function text(errors: Errors, body: any, field: string, max: number): string {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    errors[field] = [`The ${field.replace(/_/g, ' ')} field is required.`];
    return '';
  }
  if (value.length > max) {
    errors[field] = [`The ${field.replace(/_/g, ' ')} may not be greater than ${max} characters.`];
  }
  return value.trim();
}

function fail(errors: Errors): void {
  if (Object.keys(errors).length) {
    throw new UnprocessableEntityException({ message: Object.values(errors)[0][0], errors });
  }
}

/**
 * The mobile guest API (escalated-developer-context
 * domain-model/mobile-guest-api.md, after escalated-laravel's
 * MobileGuestTicketController): create a ticket with an emailed code, and read
 * or answer the ticket a grant opens. Codes, grants and the guest identity
 * policy are the widget's own (`GuestAccessService`, `GuestTicketsService`).
 */
@Injectable()
export class MobileGuestTicketsService {
  constructor(
    private readonly guestAccess: GuestAccessService,
    private readonly guestTickets: GuestTicketsService,
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly contactService: ContactService,
    private readonly departmentService: DepartmentService,
    private readonly settingsService: SettingsService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Reply) private readonly replies: Repository<Reply>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
  ) {}

  /**
   * `POST guest/tickets`: validate, spend a `ticket` code, then file the
   * ticket under the guest policy and hand out its first grant. Nothing is
   * created when the fields or the code are wrong.
   */
  async create(body: any) {
    const errors: Errors = {};
    const name = text(errors, body, 'name', 255);
    if (!this.guestAccess.isValidEmail(body?.email)) {
      errors.email = ['The email field must be a valid email address.'];
    }
    const subject = text(errors, body, 'subject', 255);
    const description = text(errors, body, 'description', MAX_TEXT);
    if (typeof body?.verification_id !== 'string' || !UUID.test(body.verification_id)) {
      errors.verification_id = ['The verification id field must be a valid UUID.'];
    }
    text(errors, body, 'verification_code', 16);
    const rawPriority = body?.priority;
    const priority =
      rawPriority === undefined || rawPriority === null || rawPriority === ''
        ? 'medium'
        : String(rawPriority);
    if (!(PRIORITIES as readonly string[]).includes(priority)) {
      errors.priority = ['The selected priority is invalid.'];
    }
    let departmentId: number | undefined;
    try {
      departmentId = await widgetDepartmentId(this.departmentService, body?.department_id);
    } catch (error) {
      if (!(error instanceof UnprocessableEntityException)) throw error;
      errors.department_id = ['The selected department is invalid.'];
    }
    fail(errors);

    const email = normalizeEmail(body.email);
    const { ticket, grant } = await this.guestTickets.withProof(
      { ...body, email },
      'ticket',
      async () => {
        const contact = await this.contactService.findOrCreateByEmail(email, name);
        const policy = await resolveGuestPolicy(this.settingsService, this.options);
        const created = await this.ticketService.create(
          { subject, description, priority, channel: 'web', departmentId, contactId: contact.id },
          requesterIdForPolicy(policy),
        );
        if (policy?.mode === 'prompt_signup') {
          this.eventEmitter.emit(
            ESCALATED_EVENTS.SIGNUP_INVITE,
            new TicketSignupInviteEvent(created.id, contact.id, email),
          );
        }
        this.guestAccess.markVerified(created, email);
        return { ticket: created, grant: await this.guestAccess.issue(created) };
      },
    );

    return { data: await this.payload(ticket.id, grant, false), message: 'Ticket created.' };
  }

  /** `GET guest/tickets/:token`: the ticket with its public replies, newest first. */
  async show(ticket: Ticket, token: string) {
    const grant = { token, expiresAt: new Date(ticket.guestAccessExpiresAt as Date) };
    return { data: await this.payload(ticket.id, grant, true) };
  }

  /**
   * `POST guest/tickets/:token/replies`: a public reply from the guest. The
   * email must be the ticket's guest email, a second factor on top of the
   * grant.
   */
  async reply(ticket: Ticket, body: any) {
    if (ticket.status?.slug === 'closed') {
      throw new UnprocessableEntityException({ message: 'This ticket is closed.' });
    }
    const errors: Errors = {};
    const message = text(errors, body, 'body', MAX_TEXT);
    if (!this.guestAccess.isValidEmail(body?.email)) {
      errors.email = ['The email field must be a valid email address.'];
    }
    fail(errors);

    const guestEmail = normalizeEmail(await this.guestAccess.guestEmail(ticket));
    if (!guestEmail || guestEmail !== normalizeEmail(body.email)) {
      throw new ForbiddenException({
        message: 'The provided email does not match this ticket.',
      });
    }

    // Filed as the ticket's requester, as the widget files guest replies, so
    // it is never mistaken for a staff answer.
    await this.replyService.create(ticket.id, { body: message, type: 'reply' }, ticket.requesterId);
    return { message: 'Reply sent.' };
  }

  /** The allow-listed mobile ticket object. Never the entity. */
  private async payload(ticketId: number, grant: GuestGrant | null, withReplies: boolean) {
    const ticket = await this.tickets.findOneOrFail({
      where: { id: ticketId },
      relations: { status: true, department: true },
    });
    const contact =
      ticket.contactId == null
        ? null
        : await this.contacts.findOne({ where: { id: ticket.contactId } });
    const requester = { name: contact?.name || 'Guest', email: contact?.email ?? '' };

    const replies = withReplies
      ? await this.replies.find({
          where: { ticketId: ticket.id, isInternal: false },
          relations: { attachments: true },
          order: { createdAt: 'DESC', id: 'DESC' },
        })
      : [];
    const isGuest = (userId: unknown) =>
      userId === null || userId === undefined || String(userId) === String(ticket.requesterId);
    const staffIds = [
      ...new Set(
        [ticket.assigneeId, ...replies.map((reply) => reply.userId)].filter(
          (id) => id !== null && id !== undefined && !isGuest(id),
        ),
      ),
    ];
    const names = new Map<string, string>();
    if (staffIds.length) {
      const profiles = await this.profiles.find({ where: { userId: In(staffIds) } });
      for (const profile of profiles) {
        if (profile.displayName) names.set(String(profile.userId), profile.displayName);
      }
    }
    const staff = (id: unknown) => ({
      id: 0,
      name: names.get(String(id)) ?? 'Support',
      email: '',
    });

    const status = ticket.status;
    const department = ticket.department;
    return {
      id: ticket.id,
      reference: ticket.referenceNumber,
      guest_access_token: grant?.token ?? null,
      guest_access_expires_at: grant ? iso(grant.expiresAt) : null,
      subject: ticket.subject,
      description: ticket.description ?? '',
      status: {
        value: status?.slug ?? 'open',
        label: status?.name ?? label(status?.slug ?? 'open'),
      },
      priority: {
        value: ticket.priority,
        label: PRIORITY_LABELS[ticket.priority] ?? label(String(ticket.priority ?? '')),
      },
      channel: ticket.channel,
      metadata: {},
      requester,
      assignee:
        ticket.assigneeId === null || ticket.assigneeId === undefined
          ? null
          : staff(ticket.assigneeId),
      department: department ? { id: department.id, name: department.name } : null,
      tags: [],
      replies: replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        is_internal_note: false,
        is_pinned: false,
        author: isGuest(reply.userId) ? { id: 0, ...requester } : staff(reply.userId),
        // No guest-authorised download route exists yet, so no URL is given.
        attachments: (reply.attachments ?? []).map((attachment) => ({
          id: attachment.id,
          filename: attachment.fileName,
          mime_type: attachment.mimeType,
          size: attachment.fileSize,
          url: null,
        })),
        created_at: iso(reply.createdAt),
      })),
      activities: [],
      sla: {
        first_response_due_at: iso(ticket.firstResponseDueAt),
        first_response_at: iso(ticket.firstRespondedAt),
        first_response_breached: !!ticket.slaFirstResponseBreached,
        resolution_due_at: iso(ticket.resolutionDueAt),
        resolution_breached: !!ticket.slaResolutionBreached,
      },
      is_following: false,
      followers_count: 0,
      resolved_at: iso(ticket.resolvedAt),
      closed_at: iso(ticket.closedAt),
      created_at: iso(ticket.createdAt),
      updated_at: iso(ticket.updatedAt),
    };
  }
}
