import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { TicketReadsService } from '../../services/ticket-reads.service';
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
    @InjectRepository(Ticket) private readonly ticketRows: Repository<Ticket>,
    @Optional() reads?: TicketReadsService,
  ) {
    super(data, tickets, replies, macros, statuses, options);
    this.reads = reads;
  }

  /**
   * Bulk actions from the agent ticket list (`escalated.agent.tickets.bulk`),
   * on the tickets the agent can see, including `mark_read` / `mark_unread`.
   */
  @Post('tickets/bulk')
  @HttpCode(200)
  async bulk(@Body() body: any, @Req() req: any) {
    return this.bulkAction(body, req, 'escalated.agent.tickets.index', (ids) =>
      this.ticketRows.find({ where: { id: In(ids) }, relations: { tags: true } }),
    );
  }

  @Get()
  async dashboard(@Req() req: any) {
    return inertia('Escalated/Agent/Dashboard', await this.data.agentDashboard(requireUserId(req)));
  }
}
