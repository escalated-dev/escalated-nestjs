import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import type { UserId } from '../../config/user-id-column';
import { SavedView } from '../../entities/saved-view.entity';
import { Ticket } from '../../entities/ticket.entity';
import { TicketStatus } from '../../entities/ticket-status.entity';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { MacroService } from '../../services/macro.service';
import { ReplyService } from '../../services/reply.service';
import { TicketService } from '../../services/ticket.service';
import { back, inertia } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { wantsPage } from '../request';
import { routeUrl } from '../routes';
import { iso } from '../serializers';
import { UiDataService } from '../ui-data.service';
import { PRIORITIES, TicketScreenActions } from './ticket-screen-actions';

const BULK_ACTIONS = ['status', 'priority', 'assign', 'tags', 'department', 'delete'];

function sameUser(a: UserId | null | undefined, b: UserId): boolean {
  return a != null && String(a) === String(b);
}

/** A saved view as the views sidebar reads it (escalated-laravel's `SavedView`). */
export function serializeSavedView(view: SavedView) {
  return {
    id: view.id,
    name: view.name,
    user_id: view.userId ?? null,
    filters: view.filters ?? {},
    columns: view.columns ?? null,
    sort_by: view.sortBy ?? null,
    sort_direction: view.sortDirection ?? 'desc',
    is_shared: view.isShared === true,
    is_default: view.isDefault === true,
    position: view.sortOrder ?? 0,
    color: null,
    created_at: iso(view.createdAt),
    updated_at: iso(view.updatedAt),
  };
}

function savedViewInput(body: any): Partial<SavedView> {
  const name = body?.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new UiValidationException({ name: 'The name field is required.' });
  }
  if (name.length > 255) {
    throw new UiValidationException({ name: 'The name may not be greater than 255 characters.' });
  }
  const filters = body?.filters ?? {};
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new UiValidationException({ filters: 'The filters must be an object.' });
  }
  const input: Partial<SavedView> = { name: name.trim(), filters };
  if (body?.is_shared !== undefined) input.isShared = body.is_shared === true;
  return input;
}

/**
 * The admin ticket screens (registered with `ui.enabled`), as
 * escalated-laravel's Admin\TicketController, BulkActionController and
 * SavedViewController serve them: `Escalated/Admin/Tickets/Index` and
 * `Show`, the ticket actions the screen posts, snooze, bulk actions, and the
 * saved views of the views sidebar.
 */
@UseGuards(EscalatedAdminGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/admin')
export class AdminTicketsUiController extends TicketScreenActions {
  protected readonly showRoute = 'escalated.admin.tickets.show';

  constructor(
    data: UiDataService,
    tickets: TicketService,
    replies: ReplyService,
    macros: MacroService,
    @InjectRepository(TicketStatus) statuses: Repository<TicketStatus>,
    @Inject(ESCALATED_OPTIONS) options: EscalatedModuleOptions,
    @InjectRepository(SavedView) private readonly views: Repository<SavedView>,
    @InjectRepository(Ticket) private readonly ticketRows: Repository<Ticket>,
  ) {
    super(data, tickets, replies, macros, statuses, options);
  }

  private async savedViewsFor(userId: UserId) {
    const rows = await this.views
      .createQueryBuilder('view')
      .where('(view.isShared = :shared OR view.userId = :userId)', {
        shared: true,
        userId: String(userId),
      })
      .orderBy('view.sortOrder', 'ASC')
      .addOrderBy('view.id', 'ASC')
      .getMany();
    return rows.map(serializeSavedView);
  }

  @Get('tickets')
  async index(@Req() req: any) {
    const userId = requireUserId(req);
    const query = { ...(req.query ?? {}) };
    return inertia('Escalated/Admin/Tickets/Index', {
      tickets: await this.data.ticketList(query, userId, routeUrl('escalated.admin.tickets.index')),
      filters: query,
      departments: await this.data.departmentOptions(),
      tags: await this.data.tagOptions(),
      agents: await this.data.agentOptions(),
      savedViews: await this.savedViewsFor(userId),
    });
  }

  /** Bulk actions from the ticket list. Declared before `tickets/:ticket`. */
  @Post('tickets/bulk')
  @HttpCode(200)
  async bulk(@Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ids = Array.isArray(body?.ticket_ids) ? body.ticket_ids.map(Number) : [];
    if (!ids.length || ids.some((id: number) => !Number.isInteger(id) || id < 1)) {
      throw new UiValidationException({ ticket_ids: 'The ticket ids field is required.' });
    }
    const action = body?.action;
    if (!BULK_ACTIONS.includes(action)) {
      throw new UiValidationException({ action: 'The selected action is invalid.' });
    }
    const value = body?.value;
    if (action !== 'delete' && (value == null || value === '')) {
      throw new UiValidationException({ value: 'The value field is required.' });
    }

    let change: (ticket: Ticket) => Promise<unknown>;
    switch (action) {
      case 'status': {
        const status = await this.statusBySlug(String(value), 'value');
        change = (t) => this.tickets.update(t.id, { statusId: status.id }, userId);
        break;
      }
      case 'priority':
        if (!PRIORITIES.includes(value)) {
          throw new UiValidationException({ value: 'The selected priority is invalid.' });
        }
        change = (t) => this.tickets.update(t.id, { priority: value }, userId);
        break;
      case 'assign':
        change = (t) => this.tickets.update(t.id, { assigneeId: value }, userId);
        break;
      case 'department':
        change = (t) => this.tickets.update(t.id, { departmentId: Number(value) }, userId);
        break;
      case 'tags': {
        // Adds the tags, as Laravel's bulk `tags` does; it never removes any.
        const add = (Array.isArray(value) ? value : [value]).map(Number);
        change = (t) =>
          this.tickets.update(
            t.id,
            { tagIds: [...new Set([...(t.tags ?? []).map((tag) => tag.id), ...add])] },
            userId,
          );
        break;
      }
      default:
        change = (t) => this.tickets.delete(t.id);
    }

    const rows = await this.ticketRows.find({ where: { id: In(ids) }, relations: { tags: true } });
    let count = 0;
    for (const ticket of rows) {
      try {
        await change(ticket);
        count += 1;
      } catch {
        // Skip tickets that fail, as Laravel's bulk action does.
      }
    }
    const message = `${count} ticket(s) updated.`;
    if (wantsPage(this.options, req)) {
      return back(routeUrl('escalated.admin.tickets.index'), { success: message });
    }
    return { message, count };
  }

  @Get('tickets/:ticket')
  async show(@Param('ticket') param: string, @Req() req: any) {
    const ticket = await this.data.ticket(param);
    return inertia('Escalated/Admin/Tickets/Show', {
      ...(await this.data.ticketScreen(ticket, requireUserId(req))),
      agents: await this.data.agentOptions(),
    });
  }

  @Post('tickets/:ticket/snooze')
  @HttpCode(200)
  async snooze(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const until = new Date(String(body?.snoozed_until ?? ''));
    if (!body?.snoozed_until || Number.isNaN(until.getTime()) || until <= new Date()) {
      throw new UiValidationException({
        snoozed_until: 'The snoozed until must be a date in the future.',
      });
    }
    const updated = await this.tickets.update(
      ticket.id,
      { snoozedUntil: until.toISOString() },
      userId,
    );
    return this.done(req, ticket.id, `Ticket snoozed until ${until.toISOString()}.`, {
      ticket: updated,
    });
  }

  @Post('tickets/:ticket/unsnooze')
  @HttpCode(200)
  async unsnooze(@Param('ticket') param: string, @Req() req: any) {
    const ticket = await this.data.ticket(param);
    await this.tickets.unsnooze(ticket.id);
    return this.done(req, ticket.id, 'Ticket unsnoozed.');
  }

  // Saved views (the views sidebar and the save-view dialog call these with fetch).

  @Post('saved-views')
  @HttpCode(201)
  async storeView(@Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const input = savedViewInput(body);
    const last = await this.views
      .createQueryBuilder('view')
      .select('MAX(view.sortOrder)', 'max')
      .where('view.userId = :userId', { userId: String(userId) })
      .getRawOne();
    const view = await this.views.save(
      this.views.create({
        ...input,
        isShared: input.isShared ?? false,
        userId,
        sortOrder: Number(last?.max ?? 0) + 1,
      }),
    );
    return serializeSavedView(view);
  }

  private async ownView(id: number, userId: UserId): Promise<SavedView> {
    const view = await this.views.findOne({ where: { id } });
    if (!view) throw new NotFoundException('Saved view not found');
    if (view.userId != null && !sameUser(view.userId, userId)) throw new ForbiddenException();
    return view;
  }

  @Put('saved-views/:id')
  async updateView(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    const view = await this.ownView(id, requireUserId(req));
    Object.assign(view, savedViewInput(body));
    return serializeSavedView(await this.views.save(view));
  }

  @Delete('saved-views/:id')
  @HttpCode(200)
  async destroyView(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.views.remove(await this.ownView(id, requireUserId(req)));
    return { message: 'View deleted.' };
  }
}
