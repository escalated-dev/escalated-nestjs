import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { TicketService } from '../../services/ticket.service';
import { ReplyService } from '../../services/reply.service';
import { KnowledgeBaseService } from '../../services/knowledge-base.service';
import { SatisfactionRatingService } from '../../services/satisfaction-rating.service';
import { GuestAccessGuard } from '../../guards/guest-access.guard';

@Controller('escalated/widget')
export class WidgetController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly kbService: KnowledgeBaseService,
    private readonly satisfactionService: SatisfactionRatingService,
  ) {}

  @Post('tickets')
  async createTicket(@Body() body: any) {
    const ticket = await this.ticketService.create(
      {
        subject: body.subject,
        description: body.description,
        priority: body.priority || 'medium',
        channel: 'widget',
      },
      body.requesterId || 0,
    );

    return {
      ticket,
      guestAccessToken: ticket.guestAccessToken,
    };
  }

  @Get('tickets/:id')
  @UseGuards(GuestAccessGuard)
  async showTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = req.guestTicket || (await this.ticketService.findById(id));
    const replies = await this.replyService.findByTicketId(id, false);
    return { ticket, replies };
  }

  @Post('tickets/:id/replies')
  @UseGuards(GuestAccessGuard)
  async addReply(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { body: string },
    @Req() req: any,
  ) {
    const ticket = req.guestTicket;
    return this.replyService.create(id, { body: body.body, type: 'reply' }, ticket.requesterId);
  }

  // KB search for widget
  @Get('kb/search')
  async searchKb(@Query('q') query: string) {
    if (!query) return [];
    return this.kbService.searchArticles(query);
  }

  @Get('kb/articles/:slug')
  async readArticle(@Param('slug') slug: string) {
    return this.kbService.findArticleBySlug(slug);
  }

  // CSAT via token
  @Get('rate/:token')
  async showRating(@Param('token') token: string) {
    return this.satisfactionService.findByToken(token);
  }

  @Post('rate/:token')
  async submitRating(
    @Param('token') token: string,
    @Body() body: { rating: number; comment?: string },
  ) {
    return this.satisfactionService.submitByToken(token, body.rating, body.comment);
  }
}
