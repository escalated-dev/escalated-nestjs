import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChatSessionService } from '../../services/chat-session.service';
import { DepartmentService } from '../../services/department.service';
import { SatisfactionRatingService } from '../../services/satisfaction-rating.service';
import { ChatSession } from '../../entities/chat-session.entity';
import { embedOrigin } from '../../services/widget-origins.service';
import { sanitizeWidgetMetadata } from '../../services/widget-metadata';
import { widgetDepartmentId, widgetValidationError } from './widget-input';
import { GuestTicketsService } from '../../services/guest-tickets.service';
import { GuestThrottle, GuestThrottleGuard } from '../../guards/guest-throttle.guard';

/**
 * Live chat for widget visitors. A chat is reached only through the
 * unguessable token returned as `id` when it starts; numeric session ids are
 * never accepted here, so one visitor cannot read or act on another's chat.
 */
@Controller('escalated/widget/chat')
export class WidgetChatController {
  constructor(
    private readonly chatSessionService: ChatSessionService,
    private readonly departmentService: DepartmentService,
    private readonly satisfactionService: SatisfactionRatingService,
    private readonly guestTickets: GuestTicketsService,
  ) {}

  @Get('availability')
  async availability(
    @Query('department_id') departmentIdParam?: string,
    @Query('departmentId') legacyDepartmentId?: string,
  ) {
    const raw = departmentIdParam ?? legacyDepartmentId;
    const deptId = raw ? parseInt(raw, 10) || undefined : undefined;
    const queueDepth = await this.chatSessionService.getQueueDepth(deptId);
    return { available: true, queueDepth };
  }

  /**
   * Starts a chat. The visitor proves their email with a `chat` code
   * (`verification_id`, `verification_code`); see docs/guest-access.md.
   */
  @Post('start')
  @GuestThrottle('chat')
  @UseGuards(GuestThrottleGuard)
  async start(
    @Body()
    body: {
      name?: string;
      email?: string;
      message?: string;
      /** An active department; empty means none. */
      department_id?: number | string | null;
      /** @deprecated Use `department_id`. */
      departmentId?: number;
      /** Host parameters from the embedding page, kept on the chat's ticket. */
      metadata?: Record<string, unknown>;
      verification_id?: string;
      verification_code?: string;
    },
    @Req() req?: any,
  ) {
    return this.guestTickets.withProof(body, 'chat', () => this.startChat(body, req));
  }

  private async startChat(body: any, req?: any) {
    const metadata = sanitizeWidgetMetadata(body.metadata, embedOrigin(req));
    const departmentId = await widgetDepartmentId(
      this.departmentService,
      body.department_id ?? body.departmentId,
    );
    const session = await this.chatSessionService.start(
      body.name || 'Visitor',
      body.email,
      body.message,
      departmentId,
      metadata,
    );
    const token = await this.chatSessionService.issueVisitorToken(session);

    return {
      // The visitor's key for every /chat/:id route below.
      id: token,
      session_id: session.id,
      ticketId: session.ticketId,
      status: session.status,
      visitorName: session.visitorName,
      createdAt: session.createdAt,
    };
  }

  /** The transcript the widget polls. */
  @Get(':token/messages')
  async messages(@Param('token') token: string) {
    const session = await this.chatSessionService.findByVisitorToken(token);
    const { messages, agent } = await this.chatSessionService.transcript(session);
    return {
      messages,
      agent,
      // Agents type over the websocket; nothing is stored to report here.
      typing: null,
      ended: session.status === 'ended',
    };
  }

  @Post(':token/messages')
  async sendMessage(@Param('token') token: string, @Body() body: { body?: unknown }) {
    const session = await this.openSession(token);
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!text) throw widgetValidationError('body', 'The message is required.');
    if (text.length > 5000)
      throw widgetValidationError('body', 'The message may not be longer than 5000 characters.');

    return this.chatSessionService.sendMessage(session.id, text, undefined, 'visitor');
  }

  @Post(':token/typing')
  @HttpCode(200)
  async typing(@Param('token') token: string) {
    const session = await this.openSession(token);
    await this.chatSessionService.visitorTyping(session);
    return { message: 'Typing updated.' };
  }

  @Post(':token/end')
  async end(@Param('token') token: string) {
    const session = await this.openSession(token, 'Chat has already ended.');
    const ended = await this.chatSessionService.end(session.id);
    return {
      id: token,
      status: ended.status,
      endedAt: ended.endedAt,
    };
  }

  @Post(':token/rate')
  @HttpCode(200)
  async rate(@Param('token') token: string, @Body() body: { rating?: unknown; comment?: unknown }) {
    const session = await this.chatSessionService.findByVisitorToken(token);
    if (session.status !== 'ended') {
      throw widgetValidationError('rating', 'Chat must be ended before rating.');
    }
    const rating = Number(body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw widgetValidationError('rating', 'The rating must be a whole number from 1 to 5.');
    }
    const comment =
      typeof body?.comment === 'string' && body.comment.trim()
        ? body.comment.trim().slice(0, 1000)
        : undefined;

    try {
      await this.satisfactionService.create({
        ticketId: session.ticketId,
        customerId: 0,
        rating,
        comment,
      });
    } catch (error) {
      // The only refusal left is a rating that already exists.
      if (error instanceof BadRequestException) {
        throw widgetValidationError('rating', 'This chat has already been rated.');
      }
      throw error;
    }
    return { message: 'Rating submitted.' };
  }

  /** The visitor's chat, refusing ones that have ended. */
  private async openSession(token: string, endedMessage = 'Chat has ended.'): Promise<ChatSession> {
    const session = await this.chatSessionService.findByVisitorToken(token);
    if (session.status === 'ended') throw widgetValidationError('chat', endedMessage);
    return session;
  }
}
