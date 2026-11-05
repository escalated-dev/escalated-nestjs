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
import { back, inertia, InertiaBack } from '../../ui/inertia';
import { EscalatedUi, UiValidationException } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { UiDataService } from '../../ui/ui-data.service';
import { AgentInboxService, listFilterErrors } from '../../ui/agent-inbox.service';
import { TicketReadsService } from '../../services/ticket-reads.service';
import { CustomerPresenceService } from '../../services/customer-presence.service';
import type { UserId } from '../../config/user-id-column';
import type { Ticket } from '../../entities/ticket.entity';

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
    @Optional() private readonly inbox?: AgentInboxService,
    @Optional() private readonly reads?: TicketReadsService,
    @Optional() private readonly presence?: CustomerPresenceService,
  ) {}

  /**
   * `is_unread`, `requester_online` and `requester_last_seen_at` on agent
   * rows (ADR 2026-11-05-agent-panel-data), from one query each per page.
   */
  private async decorateRows(
    agent: UserId,
    rows: Array<Pick<Ticket, 'id' | 'lastCustomerActivityAt' | 'requesterId' | 'contactId'>>,
    serialized: Array<Record<string, any>>,
  ): Promise<void> {
    const flags = this.reads ? await this.reads.flags(agent, rows) : null;
    const seen = this.presence ? await this.presence.lookup(rows) : null;
    rows.forEach((row, i) => {
      if (flags) serialized[i].is_unread = flags.get(row.id) ?? false;
      if (seen) Object.assign(serialized[i], seen.get(row.id));
    });
  }

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
    if (this.ui && this.inbox && wantsPage(this.options, req)) {
      const query = { ...(req.query ?? {}) };
      const errors = listFilterErrors(query);
      if (errors) {
        // escalated-laravel's $request->validate(): a page visit goes back with
        // the errors (the next page's `errors` prop), not a 422 the Inertia
        // client would show as an error modal. JSON clients take the API
        // branch below, which these filters are not part of.
        return new InertiaBack(routeUrl('escalated.agent.tickets.index'), {}, errors);
      }
      const agent = requireUserId(req);
      const selected = this.inbox.normaliseFilters(query, agent);
      const queue = await this.inbox.queueFor(selected, agent);
      this.inbox.remember(req, queue);
      return inertia('Escalated/Agent/TicketIndex', {
        tickets: await this.ui.ticketList(
          this.inbox.listFilters(selected, queue),
          agent,
          routeUrl('escalated.agent.tickets.index'),
          {},
          (rows, serialized) => this.decorateRows(agent, rows, serialized),
        ),
        filters: query,
        departments: await this.ui.departmentOptions(),
        tags: await this.ui.tagOptions(),
        queue: this.inbox.queueProp(queue),
        inbox: await this.inbox.summary(agent, queue),
      });
    }
    return this.ticketService.findAll(filters);
  }

  @Get(':id')
  async show(@Param('id') idOrReference: string | number, @Req() req?: any): Promise<any> {
    const ticket = await this.findTicket(idOrReference);
    const id = ticket.id;
    if (this.ui && this.inbox && wantsPage(this.options, req)) return this.page(ticket, req);
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
        custom_fields: await this.ticketService.customFieldValues(id),
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
    return this.ticketService.create(dto, userId, { customFieldsRequired: true });
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
    const agent = requireUserId(req);
    // Opening the ticket in the agent panel is reading it.
    await this.reads?.markRead(agent, ticket.id);
    const queue = await this.inbox!.recalled(req, agent);
    const screen = await this.ui!.ticketScreen(ticket, agent);
    const extra: Record<string, any> = {};
    await this.decorateRows(agent, [ticket], [extra]);
    if (this.reads) extra.is_unread = false;
    return inertia('Escalated/Agent/TicketShow', {
      ...screen,
      ticket: {
        ...screen.ticket,
        ...extra,
        requester_tickets: await this.ui!.requesterTickets(ticket),
      },
      agents: await this.ui!.assignableAgents(ticket),
      customActions: this.customActionsForTicket(ticket, req?.user ?? null),
      queue: this.inbox!.queueProp(queue),
      inbox: await this.inbox!.summary(agent, queue),
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

  /**
   * Snoozes the ticket until `snoozed_until`, a date in the future, as
   * escalated-laravel's `escalated.agent.tickets.snooze`; the screen gets a
   * redirect back with a flash message. API clients may still send
   * `snoozedUntil`, which keeps its old checks and answer.
   */
  @Post(':id/snooze')
  async snooze(@Param('id') idOrReference: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.findTicket(idOrReference);
    const page = wantsPage(this.options, req);
    if (!page && body?.snoozed_until === undefined && body?.snoozedUntil !== undefined) {
      return this.ticketService.update(ticket.id, { snoozedUntil: body.snoozedUntil }, userId);
    }
    const until = new Date(String(body?.snoozed_until ?? ''));
    if (!body?.snoozed_until || Number.isNaN(until.getTime()) || until <= new Date()) {
      throw new UiValidationException({
        snoozed_until: 'The snoozed until must be a date in the future.',
      });
    }
    const updated = await this.ticketService.update(
      ticket.id,
      { snoozedUntil: until.toISOString() },
      userId,
    );
    if (page) {
      return back(routeUrl('escalated.agent.tickets.show', { ticket: ticket.referenceNumber }), {
        success: `Ticket snoozed until ${until.toISOString()}.`,
      });
    }
    return updated;
  }

  /** Clears the ticket's snooze (`escalated.agent.tickets.unsnooze`). */
  @Post(':id/unsnooze')
  async unsnooze(@Param('id') idOrReference: string, @Req() req: any) {
    const ticket = await this.findTicket(idOrReference);
    await this.ticketService.unsnooze(ticket.id);
    if (wantsPage(this.options, req)) {
      return back(routeUrl('escalated.agent.tickets.show', { ticket: ticket.referenceNumber }), {
        success: 'Ticket unsnoozed.',
      });
    }
    return this.ticketService.findById(ticket.id);
  }

  @Get(':id/activities')
  async activities(@Param('id', ParseIntPipe) id: number) {
    return this.ticketService.getActivities(id);
  }
}
