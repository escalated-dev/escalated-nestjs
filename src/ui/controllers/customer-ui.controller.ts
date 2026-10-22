import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { isSolvedStatus, pickDefaultStatus } from '../../entities/status-category';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import type { UserId } from '../../config/user-id-column';
import { Ticket } from '../../entities/ticket.entity';
import { TicketStatus } from '../../entities/ticket-status.entity';
import { EscalatedCustomerGuard } from '../../guards/escalated-route.guard';
import { ReplyService } from '../../services/reply.service';
import { TicketService } from '../../services/ticket.service';
import { back, inertia, redirect } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { wantsPage } from '../request';
import { routeUrl } from '../routes';
import { UiDataService } from '../ui-data.service';

export const CUSTOMER_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TICKET_TYPES = ['question', 'problem', 'incident', 'task'];
/** The list filters a customer can set (escalated-laravel Customer\TicketController@index). */
export const CUSTOMER_FILTERS = [
  'status',
  'priority',
  'ticket_type',
  'search',
  'sort_by',
  'sort_dir',
];

export function customerFilters(query: Record<string, any>): Record<string, any> {
  const filters: Record<string, any> = {};
  for (const key of CUSTOMER_FILTERS) if (query?.[key] != null) filters[key] = query[key];
  return filters;
}

/** A customer may act only on tickets they asked. */
export function assertRequester(ticket: Ticket, userId: UserId): void {
  if (String(ticket.requesterId) !== String(userId)) {
    throw new ForbiddenException('You can only access your own tickets');
  }
}

function requiredText(body: any, key: string, label: string, max = 65535): string {
  const value = body?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UiValidationException({ [key]: `The ${label} field is required.` });
  }
  if (value.length > max) {
    throw new UiValidationException({
      [key]: `The ${label} may not be greater than ${max} characters.`,
    });
  }
  return value;
}

/**
 * The customer screens' own routes (registered with `ui.enabled`), as
 * escalated-laravel's `routes/customer.php`: the ticket list at the prefix
 * root, the new-ticket form, and the reply / close / reopen actions.
 */
@UseGuards(EscalatedCustomerGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated')
export class CustomerUiController {
  constructor(
    private readonly data: UiDataService,
    private readonly tickets: TicketService,
    private readonly replies: ReplyService,
    @InjectRepository(TicketStatus) private readonly statuses: Repository<TicketStatus>,
    @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions,
  ) {}

  @Get()
  async index(@Req() req: any) {
    const userId = requireUserId(req);
    const filters = customerFilters(req.query ?? {});
    return inertia('Escalated/Customer/Index', {
      tickets: await this.data.ticketList(
        { ...filters, page: req.query?.page },
        userId,
        routeUrl('escalated.customer.tickets.index'),
        { requesterId: userId },
      ),
      filters,
    });
  }

  @Get('create')
  async create() {
    return inertia('Escalated/Customer/Create', {
      departments: await this.data.departmentOptions(),
      priorities: CUSTOMER_PRIORITIES,
      custom_fields: await this.tickets.customFieldDefinitions(),
    });
  }

  @Post()
  @HttpCode(200)
  async store(@Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const subject = requiredText(body, 'subject', 'subject', 500);
    const description = requiredText(body, 'description', 'description');
    const priority = body?.priority ?? 'medium';
    if (!CUSTOMER_PRIORITIES.includes(priority)) {
      throw new UiValidationException({ priority: 'The selected priority is invalid.' });
    }
    const ticketType = body?.ticket_type || 'question';
    if (!TICKET_TYPES.includes(ticketType)) {
      throw new UiValidationException({ ticket_type: 'The selected ticket type is invalid.' });
    }
    let departmentId: number | undefined;
    if (body?.department_id != null && body.department_id !== '') {
      departmentId = Number(body.department_id);
      const known = (await this.data.departmentOptions()).some((d) => d.id === departmentId);
      if (!Number.isInteger(departmentId) || !known) {
        throw new UiValidationException({ department_id: 'The selected department is invalid.' });
      }
    }

    const ticket = await this.tickets.create(
      {
        subject,
        description,
        priority,
        ticketType,
        departmentId,
        channel: 'web',
        custom_fields: body?.custom_fields,
      },
      userId,
      { customFieldsRequired: true },
    );
    if (!wantsPage(this.options, req)) return { message: 'Ticket created.', ticket };
    return redirect(
      routeUrl('escalated.customer.tickets.show', { ticket: ticket.referenceNumber }),
      { success: 'Ticket created.' },
    );
  }

  private async own(param: string, req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    assertRequester(ticket, userId);
    return { ticket, userId };
  }

  private done(req: any, ticket: Ticket, message: string, json: Record<string, unknown> = {}) {
    if (!wantsPage(this.options, req)) return { message, ...json };
    return back(routeUrl('escalated.customer.tickets.show', { ticket: ticket.referenceNumber }), {
      success: message,
    });
  }

  @Post('customer/tickets/:ticket/reply')
  @HttpCode(200)
  async reply(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const { ticket, userId } = await this.own(param, req);
    const reply = await this.replies.create(
      ticket.id,
      { body: requiredText(body, 'body', 'body'), type: 'reply', isInternal: false },
      userId,
    );
    return this.done(req, ticket, 'Reply sent.', { reply });
  }

  @Post('customer/tickets/:ticket/close')
  @HttpCode(200)
  async close(@Param('ticket') param: string, @Req() req: any) {
    const { ticket, userId } = await this.own(param, req);
    // The built-in `closed` status, else the first status in the `solved` category.
    const closed =
      (await this.statuses.findOne({ where: { slug: 'closed' } })) ??
      (await this.statuses.find({ order: { sortOrder: 'ASC', id: 'ASC' } })).find(isSolvedStatus);
    if (!closed) throw new UiValidationException({ status: 'No closed status is configured.' });
    const updated = await this.tickets.update(ticket.id, { statusId: closed.id }, userId);
    return this.done(req, ticket, 'Ticket closed.', { ticket: updated });
  }

  @Post('customer/tickets/:ticket/reopen')
  @HttpCode(200)
  async reopen(@Param('ticket') param: string, @Req() req: any) {
    const { ticket, userId } = await this.own(param, req);
    // `reopened`, else the default open status, else `open`: never a solved one.
    const defaults = (await this.statuses.find({ where: { isDefault: true } })).filter(
      (status) => !isSolvedStatus(status),
    );
    const reopened =
      (await this.statuses.findOne({ where: { slug: 'reopened' } })) ??
      pickDefaultStatus(defaults) ??
      (await this.statuses.findOne({ where: { slug: 'open' } }));
    if (!reopened) throw new UiValidationException({ status: 'No open status is configured.' });
    const updated = await this.tickets.update(ticket.id, { statusId: reopened.id }, userId);
    return this.done(req, ticket, 'Ticket reopened.', { ticket: updated });
  }
}
