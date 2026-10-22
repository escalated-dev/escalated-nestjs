import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import { TicketStatus } from '../../entities/ticket-status.entity';
import { EscalatedAgentGuard } from '../../guards/escalated-route.guard';
import { MacroService } from '../../services/macro.service';
import { ReplyService } from '../../services/reply.service';
import { TicketService } from '../../services/ticket.service';
import { inertia } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard } from '../inertia.interceptor';
import { UiDataService } from '../ui-data.service';
import { TicketScreenActions } from './ticket-screen-actions';

/**
 * The agent screens' own routes (registered with `ui.enabled`): the dashboard
 * and the ticket actions the ticket screen posts, as escalated-laravel's
 * `routes/agent.php` names them. Each answers a screen with a redirect back
 * and a flash message, and any other client with JSON.
 */
@UseGuards(EscalatedAgentGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/agent')
export class AgentUiController extends TicketScreenActions {
  protected readonly showRoute = 'escalated.agent.tickets.show';

  constructor(
    data: UiDataService,
    tickets: TicketService,
    replies: ReplyService,
    macros: MacroService,
    @InjectRepository(TicketStatus) statuses: Repository<TicketStatus>,
    @Inject(ESCALATED_OPTIONS) options: EscalatedModuleOptions,
  ) {
    super(data, tickets, replies, macros, statuses, options);
  }

  @Get()
  async dashboard(@Req() req: any) {
    return inertia('Escalated/Agent/Dashboard', await this.data.agentDashboard(requireUserId(req)));
  }
}
