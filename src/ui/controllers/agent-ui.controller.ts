import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import { TicketStatus } from '../../entities/ticket-status.entity';
import { EscalatedAgentGuard } from '../../guards/escalated-route.guard';
import { MacroService } from '../../services/macro.service';
import { ReplyService } from '../../services/reply.service';
import { TicketService } from '../../services/ticket.service';
import { back, inertia } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { wantsPage } from '../request';
import { routeUrl } from '../routes';
import { UiDataService } from '../ui-data.service';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

function text(body: any, key: string, label: string, max = 65535): string {
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

function integer(body: any, key: string, label: string): number {
  const value = Number(body?.[key]);
  if (body?.[key] === '' || body?.[key] == null || !Number.isInteger(value) || value < 1) {
    throw new UiValidationException({ [key]: `The ${label} field must be an integer.` });
  }
  return value;
}

/**
 * The agent screens' own routes (registered with `ui.enabled`): the dashboard
 * and the ticket actions the ticket screen posts, as escalated-laravel's
 * `routes/agent.php` names them. Each answers a screen with a redirect back
 * and a flash message, and any other client with JSON.
 */
@UseGuards(EscalatedAgentGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/agent')
export class AgentUiController {
  constructor(
    private readonly data: UiDataService,
    private readonly tickets: TicketService,
    private readonly replies: ReplyService,
    private readonly macros: MacroService,
    @InjectRepository(TicketStatus) private readonly statuses: Repository<TicketStatus>,
    @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions,
  ) {}

  @Get()
  async dashboard(@Req() req: any) {
    return inertia('Escalated/Agent/Dashboard', await this.data.agentDashboard(requireUserId(req)));
  }

  private async done(
    req: any,
    ticketId: number,
    message: string,
    json: Record<string, unknown> = {},
  ) {
    if (wantsPage(this.options, req)) {
      const ticket = await this.tickets.findById(ticketId);
      return back(routeUrl('escalated.agent.tickets.show', { ticket: ticket.referenceNumber }), {
        success: message,
      });
    }
    return { message, ...json };
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
    const slug = text(body, 'status', 'status', 100);
    const status = await this.statuses.findOne({ where: { slug } });
    if (!status) throw new UiValidationException({ status: 'The selected status is invalid.' });
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
