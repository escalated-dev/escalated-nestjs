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
} from '@nestjs/common';
import { TicketService } from '../../services/ticket.service';
import { ReplyService } from '../../services/reply.service';
import { CreateTicketDto } from '../../dto/create-ticket.dto';
import { UpdateTicketDto } from '../../dto/update-ticket.dto';
import { CreateReplyDto } from '../../dto/create-reply.dto';
import { TicketFilterDto } from '../../dto/ticket-filter.dto';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

@Controller('escalated/agent/tickets')
@UseInterceptors(AuditLogInterceptor)
export class AgentTicketController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
  ) {}

  @Get()
  async index(@Query() filters: TicketFilterDto) {
    return this.ticketService.findAll(filters);
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number) {
    const ticket = await this.ticketService.findById(id);
    const [replies, activities, chatContext, requesterTicketCount, relatedTickets] =
      await Promise.all([
        this.replyService.findByTicketId(id, true),
        this.ticketService.getActivitiesWithHumanDates(id),
        this.ticketService.getChatContext(id),
        this.ticketService.getRequesterTicketCount(ticket.requesterId),
        this.ticketService.getRelatedTickets(id),
      ]);

    return {
      ticket: {
        ...ticket,
        chat_session_id: chatContext?.chat_session_id ?? null,
        chat_started_at: chatContext?.chat_started_at ?? null,
        chat_messages: chatContext?.chat_messages ?? [],
        chat_metadata: chatContext?.chat_metadata ?? null,
        requester_ticket_count: requesterTicketCount,
        related_tickets: relatedTickets,
      },
      replies,
      activities,
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
