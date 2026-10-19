import { Controller, Get, Post, Body, Param, Query, ParseIntPipe, Req } from '@nestjs/common';
import { ChatSessionService } from '../../services/chat-session.service';
import { embedOrigin } from '../../services/widget-origins.service';
import { sanitizeWidgetMetadata } from '../../services/widget-metadata';

@Controller('escalated/widget/chat')
export class WidgetChatController {
  constructor(private readonly chatSessionService: ChatSessionService) {}

  @Get('availability')
  async availability(@Query('departmentId') departmentId?: string) {
    const deptId = departmentId ? parseInt(departmentId, 10) : undefined;
    const queueDepth = await this.chatSessionService.getQueueDepth(deptId);
    return { available: true, queueDepth };
  }

  @Post('start')
  async start(
    @Body()
    body: {
      name?: string;
      email?: string;
      message?: string;
      departmentId?: number;
      /** Host parameters from the embedding page, kept on the chat's ticket. */
      metadata?: Record<string, unknown>;
    },
    @Req() req?: any,
  ) {
    const metadata = sanitizeWidgetMetadata(body.metadata, embedOrigin(req));
    const session = await this.chatSessionService.start(
      body.name || 'Visitor',
      body.email,
      body.message,
      body.departmentId,
      metadata,
    );

    return {
      id: session.id,
      ticketId: session.ticketId,
      status: session.status,
      visitorName: session.visitorName,
      createdAt: session.createdAt,
    };
  }

  @Post(':sessionId/messages')
  async sendMessage(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: { body: string },
  ) {
    return this.chatSessionService.sendMessage(sessionId, body.body, undefined, 'visitor');
  }

  @Post(':sessionId/end')
  async end(@Param('sessionId', ParseIntPipe) sessionId: number) {
    const session = await this.chatSessionService.end(sessionId);
    return { id: session.id, status: session.status, endedAt: session.endedAt };
  }
}
