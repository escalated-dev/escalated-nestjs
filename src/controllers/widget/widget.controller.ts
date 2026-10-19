import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketService } from '../../services/ticket.service';
import { ReplyService } from '../../services/reply.service';
import { KnowledgeBaseService } from '../../services/knowledge-base.service';
import { SatisfactionRatingService } from '../../services/satisfaction-rating.service';
import { ContactService } from '../../services/contact.service';
import { SettingsService } from '../../services/settings.service';
import { DepartmentService } from '../../services/department.service';
import { embedOrigin } from '../../services/widget-origins.service';
import { sanitizeWidgetMetadata } from '../../services/widget-metadata';
import { widgetDepartmentId } from './widget-input';
import { GuestAccessGuard } from '../../guards/guest-access.guard';
import { PublicSubmitThrottleGuard } from '../../guards/public-submit-throttle.guard';
import { GuestThrottle, GuestThrottleGuard } from '../../guards/guest-throttle.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { UserId } from '../../config/user-id-column';
import { ESCALATED_EVENTS, TicketSignupInviteEvent } from '../../events/escalated.events';

/**
 * Shape accepted by POST /escalated/widget/tickets. The route is public, so the
 * requester is never taken from the body:
 *   1. Public path: supply `email` (and optionally `name`). A Contact is
 *      resolved/created and used as the ticket's `contactId`. The requester is
 *      determined by the configured guest policy.
 *   2. Host-user path: no `email`, and the host app has authenticated the
 *      request (`req.user`). The ticket is filed as that user. No Contact is
 *      created.
 *
 * `requesterId` is accepted for backwards compatibility but ignored: an
 * anonymous caller could otherwise file tickets into any user's account.
 */
interface WidgetCreateTicketBody {
  email?: string;
  name?: string;
  /** @deprecated Ignored. The requester comes from `email` or `req.user`. */
  requesterId?: UserId;
  subject: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  /** An active department; empty means none. */
  department_id?: number | string | null;
  /** Host parameters from the embedding page (order number, page URL, ...). */
  metadata?: Record<string, unknown>;
}

@Controller('escalated/widget')
export class WidgetController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly kbService: KnowledgeBaseService,
    private readonly satisfactionService: SatisfactionRatingService,
    private readonly contactService: ContactService,
    private readonly settingsService: SettingsService,
    private readonly departmentService: DepartmentService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  /**
   * Resolve the effective guest policy: settings store overrides module
   * option, so admins can change policy at runtime without redeploy.
   */
  private async resolveGuestPolicy(): Promise<EscalatedModuleOptions['guestPolicy']> {
    const stored = await this.settingsService.getTyped<
      EscalatedModuleOptions['guestPolicy'] | null
    >('guest_policy', null);
    return stored ?? this.options.guestPolicy;
  }

  private requesterIdForPolicy(policy: EscalatedModuleOptions['guestPolicy']): UserId {
    if (!policy) return 0;
    switch (policy.mode) {
      case 'guest_user':
        return policy.guestUserId;
      case 'unassigned':
      case 'prompt_signup':
      default:
        return 0;
    }
  }

  /**
   * What the widget needs before it renders. The widget routes are always
   * mounted, so the widget is always enabled; colour, position and greeting
   * come from the `widget_color`, `widget_position` and `widget_greeting`
   * settings.
   */
  @Get('config')
  async config() {
    const [color, position, greeting, departments] = await Promise.all([
      this.settingsService.getTyped('widget_color', '#4F46E5'),
      this.settingsService.getTyped('widget_position', 'bottom-right'),
      this.settingsService.getTyped('widget_greeting', 'Hi there! How can we help?'),
      this.departmentService.findAll(),
    ]);

    return {
      enabled: true,
      color,
      position,
      greeting,
      departments: departments
        .filter((department) => department.isActive !== false)
        .map(({ id, name }) => ({ id, name })),
      kb_enabled: this.options.enableKnowledgeBase !== false,
      guest_tickets_enabled: true,
      // Tickets and chats keep host parameters sent as `metadata`.
      accepts_metadata: true,
      // Looking a ticket up needs mailbox verification, which this backend
      // does not offer; widgets hide their Status tab. There is deliberately
      // no lookup by a claimed email address.
      status_lookup_enabled: false,
    };
  }

  @Post('tickets')
  @GuestThrottle('ticket')
  @UseGuards(GuestThrottleGuard, PublicSubmitThrottleGuard)
  async createTicket(@Body() body: WidgetCreateTicketBody, @Req() req?: any) {
    let contactId: number | null = null;
    let requesterId: UserId;

    const metadata = sanitizeWidgetMetadata(body.metadata, embedOrigin(req));
    const departmentId = await widgetDepartmentId(this.departmentService, body.department_id);
    const policy = await this.resolveGuestPolicy();
    // A request embedded on another site is always a guest.
    const authenticatedUserId: UserId | undefined = embedOrigin(req) ? undefined : req?.user?.id;

    if (body.email) {
      const contact = await this.contactService.findOrCreateByEmail(body.email, body.name);
      contactId = contact.id;
      requesterId = this.requesterIdForPolicy(policy);
    } else if (
      authenticatedUserId !== undefined &&
      authenticatedUserId !== null &&
      authenticatedUserId !== ''
    ) {
      // Only a host-authenticated user can file a ticket without an email.
      requesterId = authenticatedUserId;
    } else {
      throw new BadRequestException('An email is required to submit a ticket');
    }

    const ticket = await this.ticketService.create(
      {
        subject: body.subject,
        description: body.description,
        priority: body.priority || 'medium',
        channel: 'widget',
        departmentId,
        contactId,
        metadata,
      },
      requesterId,
    );

    if (body.email && contactId !== null && policy?.mode === 'prompt_signup') {
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SIGNUP_INVITE,
        new TicketSignupInviteEvent(ticket.id, contactId, body.email),
      );
    }

    return {
      message: 'Ticket created successfully.',
      reference: ticket.referenceNumber,
      guest_access_token: ticket.guestAccessToken,
      ticket,
      guestAccessToken: ticket.guestAccessToken,
    };
  }

  @Get('tickets/:id')
  @UseGuards(GuestAccessGuard)
  async showTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = req.guestTicket || (await this.ticketService.findById(id));
    const replies = await this.replyService.findByTicketId(id, false);
    return { ticket, replies };
  }

  @Post('tickets/:id/replies')
  @GuestThrottle('reply')
  // Throttle runs first so requests with a wrong guest token are counted too.
  @UseGuards(GuestThrottleGuard, GuestAccessGuard)
  async addReply(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { body: string },
    @Req() req: any,
  ) {
    const ticket = req.guestTicket;
    return this.replyService.create(id, { body: body.body, type: 'reply' }, ticket.requesterId);
  }

  /**
   * Knowledge-base search in the shape the shared widget reads. Queries
   * shorter than two characters find nothing.
   */
  @Get('articles')
  async articles(@Query('q') query?: string) {
    this.ensureKnowledgeBase();
    const q = typeof query === 'string' ? query.trim().slice(0, 200) : '';
    if (q.length < 2) return { articles: [] };

    const articles = await this.kbService.searchArticles(q);
    return {
      articles: articles.map((article) => ({
        title: article.title,
        slug: article.slug,
        excerpt: excerptOf(article.excerpt || article.content),
      })),
    };
  }

  /** One published article, in the shape the shared widget reads. */
  @Get('articles/:slug')
  async article(@Param('slug') slug: string) {
    this.ensureKnowledgeBase();
    const article = await this.kbService.findArticleBySlug(slug);
    return {
      title: article.title,
      slug: article.slug,
      body: article.content,
      category: article.category?.name ?? null,
    };
  }

  private ensureKnowledgeBase(): void {
    if (this.options.enableKnowledgeBase === false) {
      throw new NotFoundException('Knowledge base is disabled');
    }
  }

  // KB search for widget
  @Get('kb/search')
  async searchKb(@Query('q') query: string) {
    if (!query) return [];
    return this.kbService.searchArticles(query);
  }

  @Get('kb/articles/:slug')
  async readArticle(@Param('slug') slug: string) {
    return this.kbService.findArticleBySlug(slug);
  }

  // CSAT via token
  @Get('rate/:token')
  async showRating(@Param('token') token: string) {
    return this.satisfactionService.findByToken(token);
  }

  @Post('rate/:token')
  async submitRating(
    @Param('token') token: string,
    @Body() body: { rating: number; comment?: string },
  ) {
    return this.satisfactionService.submitByToken(token, body.rating, body.comment);
  }
}

/** Plain-text preview of an article: tags stripped, whitespace collapsed, 150 characters. */
function excerptOf(text: string | null | undefined): string {
  const plain = (text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 150 ? `${plain.slice(0, 147).trimEnd()}...` : plain;
}
