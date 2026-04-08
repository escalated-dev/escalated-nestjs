import { Controller, Get, Post, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ChatSessionService } from '../../services/chat-session.service';

@Controller('escalated/agent/chat')
export class AgentChatController {
  constructor(private readonly chatSessionService: ChatSessionService) {}

  @Get('queue')
  async queue() {
    return this.chatSessionService.getWaitingSessions();
  }

  @Get('active')
  async activeSessions(@Query('agentId', ParseIntPipe) agentId: number) {
    return this.chatSessionService.getActiveSessionsForAgent(agentId);
  }

  @Post(':sessionId/accept')
  async accept(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: { agentId: number },
  ) {
    return this.chatSessionService.accept(sessionId, body.agentId);
  }

  @Post(':sessionId/messages')
  async sendMessage(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: { body: string; agentId: number },
  ) {
    return this.chatSessionService.sendMessage(sessionId, body.body, body.agentId, 'agent');
  }

  @Post(':sessionId/end')
  async end(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.chatSessionService.end(sessionId);
  }

  @Get(':sessionId')
  async show(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.chatSessionService.findById(sessionId);
  }
}
