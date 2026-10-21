import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { GuestTicketsService } from '../services/guest-tickets.service';
import { privateGuestResponse } from '../services/guest-access.service';
import { ReplyService } from '../services/reply.service';
import { GuestAccessGuard } from '../guards/guest-access.guard';
import { GuestThrottle, GuestThrottleGuard } from '../guards/guest-throttle.guard';
import { clientIp, withRetryAfter } from './widget/guest-http';

/**
 * Verified guest access for host-rendered guest pages, the same-origin twin of
 * the widget routes (docs/guest-access.md): request a code, look tickets up
 * with it, and read or answer the ticket a grant opens.
 */
@Controller('escalated/guest')
export class GuestController {
  constructor(
    private readonly guestTickets: GuestTicketsService,
    private readonly replyService: ReplyService,
  ) {}

  @Post('verification')
  @HttpCode(202)
  @GuestThrottle('verification')
  @UseGuards(GuestThrottleGuard)
  async verification(@Body() body: unknown, @Req() req: any, @Res({ passthrough: true }) res: any) {
    privateGuestResponse(res);
    return withRetryAfter(res, () => this.guestTickets.requestCode(body, clientIp(req)));
  }

  @Post('lookup')
  @HttpCode(200)
  @GuestThrottle('verification')
  @UseGuards(GuestThrottleGuard)
  async lookup(@Body() body: unknown, @Res({ passthrough: true }) res: any) {
    privateGuestResponse(res);
    return this.guestTickets.lookup(body);
  }

  @Get('tickets/:ticket')
  @UseGuards(GuestAccessGuard)
  async show(@Req() req: any, @Res({ passthrough: true }) res: any) {
    privateGuestResponse(res);
    return this.guestTickets.status(req.guestTicket);
  }

  @Post('tickets/:ticket/replies')
  @GuestThrottle('reply')
  @UseGuards(GuestThrottleGuard, GuestAccessGuard)
  async reply(@Body() body: unknown, @Req() req: any, @Res({ passthrough: true }) res: any) {
    privateGuestResponse(res);
    const ticket = req.guestTicket;
    return this.replyService.create(
      ticket.id,
      { body: this.guestTickets.replyBody(body), type: 'reply' },
      ticket.requesterId,
    );
  }
}
