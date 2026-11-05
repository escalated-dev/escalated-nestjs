import { Body, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import { Ticket } from '../../entities/ticket.entity';
import { TicketStatus } from '../../entities/ticket-status.entity';
import { TicketReadsService } from '../../services/ticket-reads.service';
import { findStatusBySlugOrId } from '../../services/status-lookup';
import { MacroService } from '../../services/macro.service';
import { ReplyService } from '../../services/reply.service';
import { TicketService } from '../../services/ticket.service';
import { back } from '../inertia';
import { UiValidationException } from '../inertia.interceptor';
import { wantsPage } from '../request';
import { routeUrl } from '../routes';
import { UiDataService } from '../ui-data.service';

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const BULK_ACTIONS = [
  'status',
  'priority',
  'assign',
  'tags',
  'department',
  'delete',
  'mark_read',
  'mark_unread',
];

export function text(body: any, key: string, label: string, max = 65535): string {
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

export function integer(body: any, key: string, label: string): number {
  const value = Number(body?.[key]);
  if (body?.[key] === '' || body?.[key] == null || !Number.isInteger(value) || value < 1) {
    throw new UiValidationException({ [key]: `The ${label} field must be an integer.` });
  }
  return value;
}

/**
 * The ticket actions a ticket screen posts (`<prefix>.tickets.reply`, `note`,
 * `assign`, `status`, `priority`, `tags`, `department`, `macro`, `follow`), as
 * escalated-laravel's agent and admin TicketControllers serve them. Each
 * answers a screen with a redirect back to the ticket and a flash message, and
 * any other client with JSON. A controller serves them under its own path by
 * extending this class and naming its ticket screen route.
 */
export abstract class TicketScreenActions {
  /** The named route of the ticket screen the actions return to. */
  protected abstract readonly showRoute: string;

  constructor(
    protected readonly data: UiDataService,
    protected readonly tickets: TicketService,
    protected readonly replies: ReplyService,
    protected readonly macros: MacroService,
    protected readonly statuses: Repository<TicketStatus>,
    protected readonly options: EscalatedModuleOptions,
  ) {}

  protected async done(
    req: any,
    ticketId: number,
    message: string,
    json: Record<string, unknown> = {},
  ) {
    if (wantsPage(this.options, req)) {
      const ticket = await this.tickets.findById(ticketId);
      return back(routeUrl(this.showRoute, { ticket: ticket.referenceNumber }), {
        success: message,
      });
    }
    return { message, ...json };
  }

  /** Read markers, for the bulk `mark_read` / `mark_unread` actions. */
  protected reads?: TicketReadsService;

  /**
   * Bulk actions from a ticket list (`<prefix>.tickets.bulk`), as
   * escalated-laravel's BulkActionController: each ticket the agent can see
   * (`load` runs in the request's ticket-access scope) is changed, and one
   * that fails is skipped.
   */
  protected async bulkAction(
    body: any,
    req: any,
    indexRoute: string,
    load: (ids: number[]) => Promise<Ticket[]>,
  ) {
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
    if (
      !['delete', 'mark_read', 'mark_unread'].includes(action) &&
      (value == null || value === '')
    ) {
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
      case 'mark_read':
      case 'mark_unread': {
        // Per-agent read markers (ADR 2026-11-05-agent-panel-data).
        const reads = this.reads;
        if (!reads) throw new UiValidationException({ action: 'The selected action is invalid.' });
        change = (t) =>
          action === 'mark_read' ? reads.markRead(userId, t.id) : reads.markUnread(userId, t.id);
        break;
      }
      default:
        change = (t) => this.tickets.delete(t.id);
    }

    const rows = await load(ids);
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
      return back(routeUrl(indexRoute), { success: message });
    }
    return { message, count };
  }

  /** The ticket status with this slug (built-in or custom) or id, or a field error. */
  protected async statusBySlug(slug: string, field = 'status'): Promise<TicketStatus> {
    const status = await findStatusBySlugOrId(this.statuses, slug);
    if (!status) throw new UiValidationException({ [field]: 'The selected status is invalid.' });
    return status;
  }

  @Post('tickets/:ticket/reply')
  @HttpCode(200)
  async reply(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const reply = await this.replies.create(
      ticket.id,
      { body: text(body, 'body', 'body'), type: 'reply', isInternal: false },
      userId,
    );
    return this.done(req, ticket.id, 'Reply sent.', { reply });
  }

  @Post('tickets/:ticket/note')
  @HttpCode(200)
  async note(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const reply = await this.replies.create(
      ticket.id,
      { body: text(body, 'body', 'body'), type: 'note', isInternal: true },
      userId,
    );
    return this.done(req, ticket.id, 'Note added.', { reply });
  }

  @Post('tickets/:ticket/assign')
  @HttpCode(200)
  async assign(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const agentId = body?.agent_id;
    if (agentId == null || agentId === '' || typeof agentId === 'object') {
      throw new UiValidationException({ agent_id: 'The agent id field is required.' });
    }
    const updated = await this.tickets.update(ticket.id, { assigneeId: agentId }, userId);
    return this.done(req, ticket.id, 'Ticket assigned.', { ticket: updated });
  }

  @Post('tickets/:ticket/status')
  @HttpCode(200)
  async status(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const status = await this.statusBySlug(text(body, 'status', 'status', 100));
    const updated = await this.tickets.update(ticket.id, { statusId: status.id }, userId);
    return this.done(req, ticket.id, 'Status updated.', { ticket: updated });
  }

  @Post('tickets/:ticket/priority')
  @HttpCode(200)
  async priority(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const priority = body?.priority;
    if (!PRIORITIES.includes(priority)) {
      throw new UiValidationException({ priority: 'The selected priority is invalid.' });
    }
    const updated = await this.tickets.update(ticket.id, { priority }, userId);
    return this.done(req, ticket.id, 'Priority updated.', { ticket: updated });
  }

  @Post('tickets/:ticket/tags')
  @HttpCode(200)
  async tags(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const raw = body?.tag_ids ?? [];
    const tagIds = Array.isArray(raw) ? raw.map(Number) : [NaN];
    if (tagIds.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new UiValidationException({ tag_ids: 'The tag ids must be a list of tag ids.' });
    }
    const updated = await this.tickets.update(ticket.id, { tagIds }, userId);
    return this.done(req, ticket.id, 'Tags updated.', { ticket: updated });
  }

  @Post('tickets/:ticket/department')
  @HttpCode(200)
  async department(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const departmentId = integer(body, 'department_id', 'department id');
    const updated = await this.tickets.update(ticket.id, { departmentId }, userId);
    return this.done(req, ticket.id, 'Department updated.', { ticket: updated });
  }

  @Post('tickets/:ticket/macro')
  @HttpCode(200)
  async macro(@Param('ticket') param: string, @Body() body: any, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const macroId = integer(body, 'macro_id', 'macro id');
    const allowed = await this.macros.findAll(userId);
    const macro = allowed.find((m) => m.id === macroId);
    if (!macro) throw new UiValidationException({ macro_id: 'The selected macro is invalid.' });
    const updated = await this.macros.execute(macro.id, ticket.id, userId);
    return this.done(req, ticket.id, `Macro "${macro.name}" applied.`, { ticket: updated });
  }

  @Post('tickets/:ticket/follow')
  @HttpCode(200)
  async follow(@Param('ticket') param: string, @Req() req: any) {
    const userId = requireUserId(req);
    const ticket = await this.data.ticket(param);
    const following = await this.data.toggleFollow(ticket.id, userId);
    return this.done(
      req,
      ticket.id,
      following ? 'You are now following this ticket.' : 'You have unfollowed this ticket.',
      { following },
    );
  }
}
