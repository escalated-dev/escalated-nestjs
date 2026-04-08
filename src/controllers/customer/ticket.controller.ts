import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import { TicketService } from '../../services/ticket.service';
import { ReplyService } from '../../services/reply.service';
import { SatisfactionRatingService } from '../../services/satisfaction-rating.service';
import { CreateTicketDto } from '../../dto/create-ticket.dto';
import { CreateReplyDto } from '../../dto/create-reply.dto';

@Controller('escalated/customer/tickets')
export class CustomerTicketController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly replyService: ReplyService,
    private readonly satisfactionService: SatisfactionRatingService,
  ) {}

  @Get()
  async index(@Req() req: any, @Query('page') page?: number) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    return this.ticketService.findAll({
      requesterId: userId,
      page: page || 1,
    });
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketService.findById(id);
    const userId = req.user?.id;

    if (ticket.requesterId !== userId) {
      throw new ForbiddenException('You can only view your own tickets');
    }

    const replies = await this.replyService.findByTicketId(id, false); // No internal notes
    return { ticket, replies };
  }

  @Post()
  async create(@Body() dto: CreateTicketDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    dto.channel = dto.channel || 'web';
    return this.ticketService.create(dto, userId);
  }

  @Post(':id/replies')
  async addReply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateReplyDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    const ticket = await this.ticketService.findById(id);
    if (ticket.requesterId !== userId) {
      throw new ForbiddenException('You can only reply to your own tickets');
    }

    // Customers can't create internal notes
    dto.isInternal = false;
    dto.type = 'reply';
    return this.replyService.create(id, dto, userId);
  }

  @Post(':id/rate')
  async rate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rating: number; comment?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException();

    return this.satisfactionService.create({
      ticketId: id,
      customerId: userId,
      rating: body.rating,
      comment: body.comment,
    });
  }
}
