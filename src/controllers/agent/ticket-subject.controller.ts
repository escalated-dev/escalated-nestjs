import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { TicketService } from '../../services/ticket.service';
import { TicketSubjectService } from '../../services/ticket-subject.service';
import { EscalatedModuleOptions, ESCALATED_OPTIONS } from '../../config/escalated.config';

@Controller('escalated/agent/tickets/:ticketId/subjects')
export class AgentTicketSubjectController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly ticketSubjectService: TicketSubjectService,
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  @Post()
  async attach(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() body: { type: string; id: string | number; role?: string | null },
  ) {
    const allowed = this.options.ticketSubjects?.types ?? [];
    if (allowed.length === 0 || !allowed.includes(body.type)) {
      throw new BadRequestException(
        `Subject type [${body.type}] is not an allowed ticket subject.`,
      );
    }

    const ticket = await this.ticketService.findById(ticketId);
    const link = await this.ticketSubjectService.attach(ticket, body.type, body.id, body.role);
    const subjects = await this.ticketSubjectService.serializeLinks([link]);

    return { link, subjects };
  }

  @Delete(':linkId')
  @HttpCode(204)
  async detach(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Param('linkId', ParseIntPipe) linkId: number,
  ) {
    const ticket = await this.ticketService.findById(ticketId);
    await this.ticketSubjectService.detach(ticket, linkId);
  }
}
