import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  UseInterceptors,
  HttpCode,
  NotFoundException,
  ForbiddenException,
  UseGuards,
  Inject,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketService } from '../../services/ticket.service';
import { TicketSubjectService } from '../../services/ticket-subject.service';
import { ReplyService } from '../../services/reply.service';
import { TicketActionRegistry } from '../../services/ticket-action-registry.service';
import { CreateTicketDto } from '../../dto/create-ticket.dto';
import { UpdateTicketDto } from '../../dto/update-ticket.dto';
import { CreateReplyDto } from '../../dto/create-reply.dto';
import { TicketFilterDto } from '../../dto/ticket-filter.dto';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { ESCALATED_EVENTS, TicketCustomActionTriggeredEvent } from '../../events/escalated.events';
import { EscalatedAgentGuard } from '../../guards/escalated-route.guard';
import { requireUserId } from '../../config/request-user';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { back, inertia } from '../../ui/inertia';
import { EscalatedUi } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { UiDataService } from '../../ui/ui-data.service';

/**
 * The agent ticket JSON API. With `ui.enabled`, the index and show routes also
 * serve the agent screens to Inertia visits and browser navigations.
 */
@UseGuards(EscalatedAgentGuard)
@Controller('escalated/agent/tickets')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AgentTicketController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly ticketSubjectService: TicketSubjectService,
    private readonly replyService: ReplyService,
    private readonly ticketActions: TicketActionRegistry,
    private readonly eventEmitter: EventEmitter2,
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

  /** Serializes the visible custom actions for a ticket, adding url + method. */
  private customActionsForTicket(ticket: any, user: any): Array<Record<string, any>> {
    return this.ticketActions.forTicket(ticket, user).map((action) => ({
      ...action,
      url: `/escalated/agent/tickets/${ticket.id}/actions/${action.key}`,
      method: 'post',
    }));
  }

  @Get()
  async index(@Query() filters: TicketFilterDto, @Req() req?: any): Promise<any> {
    if (this.ui && wantsPage(this.options, req)) {
      const query = { ...(req.query ?? {}) };
      return inertia('Escalated/Agent/TicketIndex', {
        tickets: await this.ui.ticketList(
          query,
          requireUserId(req),
          routeUrl('escalated.agent.tickets.index'),
        ),
        filters: query,
        departments: await this.ui.departmentOptions(),
        tags: await this.ui.tagOptions(),
      });
    }
    return this.ticketService.findAll(filters);
  }

  @Get(':id')
  async show(@Param('id') idOrReference: string | number, @Req() req?: any): Promise<any> {
    const ticket = await this.findTicket(idOrReference);
    const id = ticket.id;
    if (this.ui && wantsPage(this.options, req)) return this.page(ticket, req);
    const [replies, activities, chatContext, requesterTicketCount, relatedTickets, subjects] =
      await Promise.all([
        this.replyService.findByTicketId(id, true),
        this.ticketService.getActivitiesWithHumanDates(id),
        this.ticketService.getChatContext(id),
        this.ticketService.getRequesterTicketCount(ticket.requesterId),
        this.ticketService.getRelatedTickets(id),
        this.ticketSubjectService.serializeForTicket(ticket),
      ]);

    return {
      ticket: {
        ...ticket,
        subjects,
        chat_session_id: chatContext?.chat_session_id ?? null,
        chat_started_at: chatContext?.chat_started_at ?? null,
        chat_messages: chatContext?.chat_messages ?? [],
        chat_metadata: chatContext?.chat_metadata ?? null,
        requester_ticket_count: requesterTicketCount,
        related_tickets: relatedTickets,
      },
      replies,
      activities,
      customActions: this.customActionsForTicket(ticket, req?.user ?? null),
    };
  }

  @Post()
  @AuditAction('create', 'ticket')
  async create(@Body() dto: CreateTicketDto, @Req() req: any) {
    const userId = requireUserId(req);
    return this.ticketService.create(dto, userId);
  }

  @Put(':id')
  @AuditAction('update', 'ticket')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTicketDto,
    @Req() req: any,
  ) {
    const userId = requireUserId(req);
    return this.ticketService.update(id, dto, userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'ticket')
  async destroy(@Param('id', ParseIntPipe) id: number) {
    await this.ticketService.delete(id);
  }

  @Post(':id/replies')
  @AuditAction('create', 'reply')
  async addReply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateReplyDto,
    @Req() req: any,
  ) {
    const userId = requireUserId(req);
    return this.replyService.create(id, dto, userId);
  }

  @Get(':id/replies')
  async getReplies(@Param('id', ParseIntPipe) id: number) {
    return this.replyService.findByTicketId(id, true);
  }

  @Post(':id/actions/:actionKey')
  @AuditAction('custom_action', 'ticket')
  async customAction(
    @Param('id') id: string | number,
    @Param('actionKey') actionKey: string,
    @Body('payload') payload: Record<string, any>,
    @Req() req: any,
  ) {
    const user = req.user ?? null;
    const userId = requireUserId(req);

    const action = this.ticketActions.find(actionKey);
    if (!action) {
      throw new NotFoundException(`Custom action "${actionKey}" not found`);
    }

    const ticket = await this.findTicket(id);
    if (!action.visible(ticket, user)) {
      throw new NotFoundException(`Custom action "${actionKey}" not found`);
    }
    if (!action.enabled(ticket, user)) {
      throw new ForbiddenException(`Custom action "${actionKey}" is not enabled`);
    }

    this.eventEmitter.emit(
      ESCALATED_EVENTS.TICKET_CUSTOM_ACTION_TRIGGERED,
      new TicketCustomActionTriggeredEvent(
        ticket,
        action.key(),
        userId,
        payload ?? {},
        action.metadata(ticket, user),
      ),
    );

    if (wantsPage(this.options, req)) {
      return back(routeUrl('escalated.agent.tickets.show', { ticket: ticket.referenceNumber }), {
        success: 'Custom action dispatched.',
      });
    }
    return { message: 'Custom action dispatched.', action: action.key() };
  }

  /** `Escalated/Agent/TicketShow`, with the props escalated-laravel's Agent TicketController@show sends. */
  private async page(ticket: any, req: any) {
    return inertia('Escalated/Agent/TicketShow', {
      ...(await this.ui!.ticketScreen(ticket, requireUserId(req))),
      customActions: this.customActionsForTicket(ticket, req?.user ?? null),
    });
  }

  @Post(':id/merge/:targetId')
  async merge(
    @Param('id', ParseIntPipe) id: number,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Req() req: any,
  ) {
    const userId = requireUserId(req);
    return this.ticketService.merge(id, targetId, userId);
  }

  @Post(':id/split')
  async split(
    @Param('id', ParseIntPipe) id: number,
    @Body('replyIds') replyIds: number[],
    @Req() req: any,
  ) {
    const userId = requireUserId(req);
    return this.ticketService.split(id, replyIds || [], userId);
  }

  @Post(':id/snooze')
  async snooze(
    @Param('id', ParseIntPipe) id: number,
    @Body('snoozedUntil') snoozedUntil: string,
    @Req() req: any,
  ) {
    const userId = requireUserId(req);
    return this.ticketService.update(id, { snoozedUntil }, userId);
  }

  @Post(':id/unsnooze')
  async unsnooze(@Param('id', ParseIntPipe) id: number) {
    await this.ticketService.unsnooze(id);
    return this.ticketService.findById(id);
  }

  @Get(':id/activities')
  async activities(@Param('id', ParseIntPipe) id: number) {
    return this.ticketService.getActivities(id);
  }
}
