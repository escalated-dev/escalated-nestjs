import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  ForbiddenException,
  UseGuards,
  Inject,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { TicketService } from '../../services/ticket.service';
import { ReplyService } from '../../services/reply.service';
import { SatisfactionRatingService } from '../../services/satisfaction-rating.service';
import { CreateTicketDto } from '../../dto/create-ticket.dto';
import { CreateReplyDto } from '../../dto/create-reply.dto';
import { EscalatedCustomerGuard } from '../../guards/escalated-route.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { back, inertia } from '../../ui/inertia';
import { EscalatedUi } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { UiDataService } from '../../ui/ui-data.service';
import { customerFilters } from '../../ui/controllers/customer-ui.controller';

/**
 * The customer ticket JSON API. With `ui.enabled`, the index, show and rate
 * routes also serve the customer screens to Inertia visits and browsers.
 */
@UseGuards(EscalatedCustomerGuard)
@Controller('escalated/customer/tickets')
@EscalatedUi()
export class CustomerTicketController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly satisfactionService: SatisfactionRatingService,
    @Optional() private readonly ui?: UiDataService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  /** A ticket by numeric id or, as the screens link to it, by reference. */
  private async findTicket(id: string | number) {
    if (typeof id === 'number' || /^\d+$/.test(String(id))) {
      return this.ticketService.findById(Number(id));
    }
    if (this.ui) return this.ui.ticket(String(id));
    throw new NotFoundException('Ticket not found');
  }

  @Get()
  async index(@Req() req: any, @Query('page') page?: number): Promise<any> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    if (this.ui && wantsPage(this.options, req)) {
      const filters = customerFilters(req.query ?? {});
      return inertia('Escalated/Customer/Index', {
        tickets: await this.ui.ticketList(
          { ...filters, page: req.query?.page },
          userId,
          routeUrl('escalated.customer.tickets.index'),
          { requesterId: userId },
        ),
        filters,
      });
    }

    return this.ticketService.findAll({
      requesterId: userId,
      page: page || 1,
    });
  }

  @Get(':id')
  async show(@Param('id') idOrReference: string | number, @Req() req: any): Promise<any> {
    const ticket = await this.findTicket(idOrReference);
    const id = ticket.id;
    const userId = req.user?.id;

    if (String(ticket.requesterId) !== String(userId)) {
      throw new ForbiddenException('You can only view your own tickets');
    }

    if (this.ui && wantsPage(this.options, req)) {
      return inertia('Escalated/Customer/Show', { ticket: await this.ui.customerTicket(ticket) });
    }

    const [replies, activities, chatContext, requesterTicketCount, relatedTickets] =
      await Promise.all([
        this.replyService.findByTicketId(id, false), // No internal notes
        this.ticketService.getActivitiesWithHumanDates(id),
        this.ticketService.getChatContext(id),
        this.ticketService.getRequesterTicketCount(ticket.requesterId),
        this.ticketService.getRelatedTickets(id),
      ]);

    // Exclude internal notes from chat messages for customer views
    const chatMessages = (chatContext?.chat_messages ?? []).filter((m) => !m.isInternal);

    return {
      ticket: {
        ...ticket,
        chat_session_id: chatContext?.chat_session_id ?? null,
        chat_started_at: chatContext?.chat_started_at ?? null,
        chat_messages: chatMessages,
        chat_metadata: chatContext?.chat_metadata ?? null,
        requester_ticket_count: requesterTicketCount,
        related_tickets: relatedTickets,
      },
      replies,
      activities,
    };
  }

  @Post()
  async create(@Body() dto: CreateTicketDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    dto.channel = dto.channel || 'web';
    return this.ticketService.create(dto, userId);
  }

  @Post(':id/replies')
  async addReply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateReplyDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    const ticket = await this.ticketService.findById(id);
    if (String(ticket.requesterId) !== String(userId)) {
      throw new ForbiddenException('You can only reply to your own tickets');
    }

    // Customers can't create internal notes
    dto.isInternal = false;
    dto.type = 'reply';
    return this.replyService.create(id, dto, userId);
  }

  @Post(':id/rate')
  async rate(
    @Param('id') idOrReference: string | number,
    @Body() body: { rating: number; comment?: string },
    @Req() req: any,
  ): Promise<any> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    const ticket = await this.findTicket(idOrReference);
    const id = ticket.id;
    if (String(ticket.requesterId) !== String(userId)) {
      throw new ForbiddenException('You can only rate your own tickets');
    }

    const rating = await this.satisfactionService.create({
      ticketId: id,
      customerId: userId,
      rating: Number(body?.rating),
      comment: body?.comment,
    });
    if (wantsPage(this.options, req)) {
      return back(routeUrl('escalated.customer.tickets.show', { ticket: ticket.referenceNumber }), {
        success: 'Thank you for your feedback.',
      });
    }
    return rating;
  }
}
