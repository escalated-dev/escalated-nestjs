import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
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
import { GuestAccessGuard } from '../../guards/guest-access.guard';
import { PublicSubmitThrottleGuard } from '../../guards/public-submit-throttle.guard';
import {
  ESCALATED_OPTIONS,
  type EscalatedModuleOptions,
} from '../../config/escalated.config';
import {
  ESCALATED_EVENTS,
  TicketSignupInviteEvent,
} from '../../events/escalated.events';

/**
 * Shape accepted by POST /escalated/widget/tickets. Either path is valid:
 *   1. Public path — supply `email` (and optionally `name`). A Contact is
 *      resolved/created and used as the ticket's `contactId`. `requesterId`
 *      is determined by the configured guest policy.
 *   2. Legacy path — supply `requesterId` for tickets created by an already-
 *      authenticated host-app user. No Contact is created.
 */
interface WidgetCreateTicketBody {
  email?: string;
  name?: string;
  requesterId?: number;
  subject: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

@Controller('escalated/widget')
export class WidgetController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly kbService: KnowledgeBaseService,
    private readonly satisfactionService: SatisfactionRatingService,
    private readonly contactService: ContactService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  private resolveGuestRequesterId(): number {
    const p = this.options.guestPolicy;
    if (!p) return 0;
    switch (p.mode) {
      case 'guest_user':
        return p.guestUserId;
      case 'unassigned':
      case 'prompt_signup':
      default:
        return 0;
    }
  }

  @Post('tickets')
  @UseGuards(PublicSubmitThrottleGuard)
  async createTicket(@Body() body: WidgetCreateTicketBody) {
    let contactId: number | null = null;
    let requesterId: number;

    if (body.email) {
      const contact = await this.contactService.findOrCreateByEmail(body.email, body.name);
      contactId = contact.id;
      requesterId = this.resolveGuestRequesterId();
    } else if (typeof body.requesterId === 'number') {
      requesterId = body.requesterId;
    } else {
      throw new BadRequestException('Either email or requesterId is required');
    }

    const ticket = await this.ticketService.create(
      {
        subject: body.subject,
        description: body.description,
        priority: body.priority || 'medium',
        channel: 'widget',
        contactId,
      },
      requesterId,
    );

    if (body.email && contactId !== null && this.options.guestPolicy?.mode === 'prompt_signup') {
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SIGNUP_INVITE,
        new TicketSignupInviteEvent(ticket.id, contactId, body.email),
      );
    }

    return {
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
  @UseGuards(GuestAccessGuard)
  async addReply(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { body: string },
    @Req() req: any,
  ) {
    const ticket = req.guestTicket;
    return this.replyService.create(id, { body: body.body, type: 'reply' }, ticket.requesterId);
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
