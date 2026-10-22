import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { isSolvedStatus } from '../../entities/status-category';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { widgetDepartmentId } from '../../controllers/widget/widget-input';
import { SatisfactionRating } from '../../entities/satisfaction-rating.entity';
import { Ticket } from '../../entities/ticket.entity';
import { ESCALATED_EVENTS, TicketSignupInviteEvent } from '../../events/escalated.events';
import { GuestThrottle, GuestThrottleGuard } from '../../guards/guest-throttle.guard';
import { PublicSubmitThrottleGuard } from '../../guards/public-submit-throttle.guard';
import { ContactService } from '../../services/contact.service';
import { DepartmentService } from '../../services/department.service';
import { GuestAccessService, privateGuestResponse } from '../../services/guest-access.service';
import { requesterIdForPolicy, resolveGuestPolicy } from '../../services/guest-policy';
import { GuestTicketsService } from '../../services/guest-tickets.service';
import { ReplyService } from '../../services/reply.service';
import { SatisfactionRatingService } from '../../services/satisfaction-rating.service';
import { SettingsService } from '../../services/settings.service';
import { TicketService } from '../../services/ticket.service';
import { back, inertia, redirect } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { routeUrl } from '../routes';
import { iso } from '../serializers';
import { UiDataService } from '../ui-data.service';

const GUEST_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const EXPIRED = 'This link has expired. Verify your email for a new one.';

function required(body: any, key: string, label: string, max: number): string {
  const value = body?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UiValidationException({ [key]: `The ${label} field is required.` });
  }
  if (value.length > max) {
    throw new UiValidationException({
      [key]: `The ${label} may not be greater than ${max} characters.`,
    });
  }
  return value.trim();
}

/**
 * The guest screens (registered with `ui.enabled`), as escalated-laravel's
 * Guest\TicketController serves them, on this backend's verified guest access
 * (docs/guest-access.md): `Escalated/Guest/Create` submits a ticket with an
 * emailed code and lands on `Escalated/Guest/Show` through an expiring grant,
 * where the guest can reply and rate.
 */
@UseGuards(ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/guest')
export class GuestUiController {
  constructor(
    private readonly guestTickets: GuestTicketsService,
    private readonly guestAccess: GuestAccessService,
    private readonly tickets: TicketService,
    private readonly replies: ReplyService,
    private readonly contacts: ContactService,
    private readonly departments: DepartmentService,
    private readonly settings: SettingsService,
    private readonly ratings: SatisfactionRatingService,
    private readonly data: UiDataService,
    private readonly events: EventEmitter2,
    @InjectRepository(Ticket) private readonly ticketRows: Repository<Ticket>,
    @InjectRepository(SatisfactionRating)
    private readonly ratingRows: Repository<SatisfactionRating>,
    @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions,
  ) {}

  @Get('create')
  async create(@Res({ passthrough: true }) res: any) {
    privateGuestResponse(res);
    return inertia('Escalated/Guest/Create', {
      departments: await this.data.departmentOptions(),
      priorities: GUEST_PRIORITIES,
      verification_url: routeUrl('escalated.guest.verification'),
      lookup_url: routeUrl('escalated.guest.lookup'),
    });
  }

  @Post()
  @HttpCode(200)
  @GuestThrottle('ticket')
  @UseGuards(GuestThrottleGuard, PublicSubmitThrottleGuard)
  async store(@Body() body: any, @Res({ passthrough: true }) res: any) {
    privateGuestResponse(res);
    const name = required(body, 'guest_name', 'name', 255);
    const email = required(body, 'guest_email', 'email', 255);
    if (!this.guestAccess.isValidEmail(email)) {
      throw new UiValidationException({ guest_email: 'Enter a valid email address.' });
    }
    const subject = required(body, 'subject', 'subject', 255);
    const description = required(body, 'description', 'description', 65535);
    const priority = body?.priority == null || body.priority === '' ? 'medium' : body.priority;
    if (!GUEST_PRIORITIES.includes(priority)) {
      throw new UiValidationException({ priority: 'The selected priority is invalid.' });
    }
    const departmentId = await widgetDepartmentId(this.departments, body?.department_id);

    const grant = await this.guestTickets.withProof(
      { email, verification_id: body?.verification_id, verification_code: body?.verification_code },
      'ticket',
      async () => {
        const contact = await this.contacts.findOrCreateByEmail(email, name);
        const policy = await resolveGuestPolicy(this.settings, this.options);
        const ticket = await this.tickets.create(
          { subject, description, priority, channel: 'web', departmentId, contactId: contact.id },
          requesterIdForPolicy(policy),
        );
        if (policy?.mode === 'prompt_signup') {
          this.events.emit(
            ESCALATED_EVENTS.SIGNUP_INVITE,
            new TicketSignupInviteEvent(ticket.id, contact.id, email),
          );
        }
        return this.guestTickets.grantFor(ticket, email);
      },
    );

    return redirect(routeUrl('escalated.guest.tickets.show', { token: grant.guest_access_token }), {
      success: 'Your ticket has been submitted. Keep this link to follow it.',
    });
  }

  /** The ticket an active grant opens, or 403 as the guest JSON routes answer. */
  private async granted(token: string): Promise<Ticket> {
    const ticket = await this.guestAccess.ticketForToken(token);
    if (!ticket) throw new ForbiddenException(EXPIRED);
    return this.ticketRows.findOneOrFail({
      where: { id: ticket.id },
      relations: { status: true, department: true },
    });
  }

  private toTicket(token: string, flash: Record<string, string>) {
    return back(routeUrl('escalated.guest.tickets.show', { token }), flash);
  }

  @Get(':token')
  async show(@Param('token') token: string, @Res({ passthrough: true }) res: any) {
    privateGuestResponse(res);
    const ticket = await this.granted(token);
    return inertia('Escalated/Guest/Show', {
      ticket: {
        ...(await this.data.customerTicket(ticket)),
        guest_access_expires_at: iso(ticket.guestAccessExpiresAt),
      },
      token,
    });
  }

  @Post(':token/reply')
  @HttpCode(200)
  @GuestThrottle('reply')
  @UseGuards(GuestThrottleGuard)
  async reply(
    @Param('token') token: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: any,
  ) {
    privateGuestResponse(res);
    const ticket = await this.granted(token);
    const text = required(body, 'body', 'reply', 65535);
    if (isSolvedStatus(ticket.status)) {
      return this.toTicket(token, { error: 'This ticket is closed.' });
    }
    await this.replies.create(ticket.id, { body: text, type: 'reply' }, ticket.requesterId);
    return this.toTicket(token, { success: 'Reply sent.' });
  }

  @Post(':token/rate')
  @HttpCode(200)
  @GuestThrottle('reply')
  @UseGuards(GuestThrottleGuard)
  async rate(
    @Param('token') token: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: any,
  ) {
    privateGuestResponse(res);
    const ticket = await this.granted(token);
    const rating = Number(body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new UiValidationException({ rating: 'The rating must be between 1 and 5.' });
    }
    const comment = typeof body?.comment === 'string' ? body.comment : undefined;
    if (comment && comment.length > 2000) {
      throw new UiValidationException({
        comment: 'The comment may not be greater than 2000 characters.',
      });
    }
    if (!isSolvedStatus(ticket.status) && !ticket.resolvedAt) {
      return this.toTicket(token, { error: 'Only resolved or closed tickets can be rated.' });
    }
    if (await this.ratingRows.existsBy({ ticketId: ticket.id })) {
      return this.toTicket(token, { error: 'This ticket has already been rated.' });
    }
    await this.ratings.create({
      ticketId: ticket.id,
      customerId: ticket.requesterId,
      rating,
      comment,
    });
    return this.toTicket(token, { success: 'Thank you for your feedback.' });
  }
}
