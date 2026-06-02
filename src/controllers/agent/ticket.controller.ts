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

@Controller('escalated/agent/tickets')
@UseInterceptors(AuditLogInterceptor)
export class AgentTicketController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly ticketSubjectService: TicketSubjectService,
    private readonly replyService: ReplyService,
    private readonly ticketActions: TicketActionRegistry,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Serializes the visible custom actions for a ticket, adding url + method. */
  private customActionsForTicket(ticket: any, user: any): Array<Record<string, any>> {
    return this.ticketActions.forTicket(ticket, user).map((action) => ({
      ...action,
      url: `/escalated/agent/tickets/${ticket.id}/actions/${action.key}`,
      method: 'post',
    }));
  }

  @Get()
  async index(@Query() filters: TicketFilterDto) {
    return this.ticketService.findAll(filters);
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number, @Req() req?: any) {
    const ticket = await this.ticketService.findById(id);
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
    const userId = req.user?.id || req.apiUserId || 1;
    return this.ticketService.create(dto, userId);
  }

  @Put(':id')
  @AuditAction('update', 'ticket')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTicketDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
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
    const userId = req.user?.id || req.apiUserId || 1;
    return this.replyService.create(id, dto, userId);
  }

  @Get(':id/replies')
  async getReplies(@Param('id', ParseIntPipe) id: number) {
    return this.replyService.findByTicketId(id, true);
  }

  @Post(':id/actions/:actionKey')
  @AuditAction('custom_action', 'ticket')
  async customAction(
    @Param('id', ParseIntPipe) id: number,
    @Param('actionKey') actionKey: string,
    @Body('payload') payload: Record<string, any>,
    @Req() req: any,
  ) {
    const user = req.user ?? null;
    const userId = req.user?.id || req.apiUserId || 1;

    const action = this.ticketActions.find(actionKey);
    if (!action) {
      throw new NotFoundException(`Custom action "${actionKey}" not found`);
    }

    const ticket = await this.ticketService.findById(id);
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

    return { message: 'Custom action dispatched.', action: action.key() };
  }

  @Post(':id/merge/:targetId')
  async merge(
    @Param('id', ParseIntPipe) id: number,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.ticketService.merge(id, targetId, userId);
  }

  @Post(':id/split')
  async split(
    @Param('id', ParseIntPipe) id: number,
    @Body('replyIds') replyIds: number[],
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.ticketService.split(id, replyIds || [], userId);
  }

  @Post(':id/snooze')
  async snooze(
    @Param('id', ParseIntPipe) id: number,
    @Body('snoozedUntil') snoozedUntil: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
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
