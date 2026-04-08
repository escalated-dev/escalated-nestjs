import { Controller, Get, Post, Param, Body, Req, ParseIntPipe } from '@nestjs/common';
import { SideConversationService } from '../../services/side-conversation.service';

@Controller('escalated/agent/tickets/:ticketId/side-conversations')
export class AgentSideConversationController {
  constructor(private readonly sideConversationService: SideConversationService) {}

  @Get()
  async list(@Param('ticketId', ParseIntPipe) ticketId: number) {
    return this.sideConversationService.findByTicket(ticketId);
  }

  @Post()
  async create(
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Body() body: { subject: string; body: string; participants?: number[] },
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.sideConversationService.create({
      ticketId,
      subject: body.subject,
      body: body.body,
      createdBy: userId,
      participants: body.participants,
    });
  }

  @Post(':id/replies')
  async addReply(
    @Param('id', ParseIntPipe) id: number,
    @Body('body') body: string,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.sideConversationService.addReply(id, userId, body);
  }

  @Post(':id/close')
  async close(@Param('id', ParseIntPipe) id: number) {
    return this.sideConversationService.close(id);
  }

  @Post(':id/reopen')
  async reopen(@Param('id', ParseIntPipe) id: number) {
    return this.sideConversationService.reopen(id);
  }
}
