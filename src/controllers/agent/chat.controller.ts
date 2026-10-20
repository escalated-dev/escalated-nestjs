import { Controller, Get, Post, Body, Param, Req, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ChatSessionService } from '../../services/chat-session.service';
import { EscalatedAgentGuard } from '../../guards/escalated-route.guard';
import { requireUserId } from '../../config/request-user';

/**
 * Agent live chat. The acting agent is always the authenticated user; an
 * `agentId` in the body or query is ignored. With restricted ticket access the
 * session lookups are scoped to the agent's visible tickets, and `accept`
 * checks the agent against the chat's ticket.
 */
@UseGuards(EscalatedAgentGuard)
@Controller('escalated/agent/chat')
export class AgentChatController {
  constructor(private readonly chatSessionService: ChatSessionService) {}

  @Get('queue')
  async queue() {
    return this.chatSessionService.getWaitingSessions();
  }

  @Get('active')
  async activeSessions(@Req() req: any) {
    return this.chatSessionService.getActiveSessionsForAgent(requireUserId(req));
  }

  @Post(':sessionId/accept')
  async accept(@Param('sessionId', ParseIntPipe) sessionId: number, @Req() req: any) {
    return this.chatSessionService.accept(sessionId, requireUserId(req));
  }

  @Post(':sessionId/messages')
  async sendMessage(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: { body: string },
    @Req() req: any,
  ) {
    return this.chatSessionService.sendMessage(sessionId, body.body, requireUserId(req), 'agent');
  }

  @Post(':sessionId/end')
  async end(@Param('sessionId', ParseIntPipe) sessionId: number, @Req() req: any) {
    return this.chatSessionService.end(sessionId, requireUserId(req));
  }

  @Get(':sessionId')
  async show(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.chatSessionService.findById(sessionId);
  }
}
