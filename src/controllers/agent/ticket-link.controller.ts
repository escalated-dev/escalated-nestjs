import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
} from '@nestjs/common';
import { TicketLinkService } from '../../services/ticket-link.service';

@Controller('escalated/agent/tickets/:ticketId/links')
export class AgentTicketLinkController {
  constructor(private readonly ticketLinkService: TicketLinkService) {}

  @Get()
  async list(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.ticketLinkService.findByTicket(ticketId);
  }

  @Post()
  async create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() body: { linkedTicketId: number; linkType: string },
  ) {
    return this.ticketLinkService.create({
      ticketId,
      linkedTicketId: body.linkedTicketId,
      linkType: body.linkType,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.ticketLinkService.delete(id);
  }
}
