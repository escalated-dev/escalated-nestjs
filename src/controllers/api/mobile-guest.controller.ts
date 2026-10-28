import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { GuestTicketsService } from '../../services/guest-tickets.service';
import { MobileGuestTicketsService } from '../../services/mobile-guest-tickets.service';
import { GuestThrottle, GuestThrottleGuard } from '../../guards/guest-throttle.guard';
import { PublicSubmitThrottleGuard } from '../../guards/public-submit-throttle.guard';
import { MobileGuestGrantGuard } from '../../guards/mobile-guest-grant.guard';
import { clientIp, withRetryAfter } from '../widget/guest-http';

/**
 * The mobile guest API (escalated-developer-context
 * domain-model/mobile-guest-api.md): the mobile face of verified guest access,
 * under the REST API prefix plus `/mobile`. Codes, grants and the per-IP guest
 * budgets are shared with the widget and guest routes, so a grant from one
 * opens the others. `{token}` is the grant itself.
 *
 * Every answer carries the guest privacy headers
 * (`GuestPrivacyHeadersMiddleware`, applied in `EscalatedModule`).
 */
@Controller('escalated/api/v1/mobile/guest')
export class MobileGuestController {
  constructor(
    private readonly guestTickets: GuestTicketsService,
    private readonly mobileGuest: MobileGuestTicketsService,
  ) {}

  /** Same handler and budget as `widget/verification`. */
  @Post('verification')
  @HttpCode(202)
  @GuestThrottle('verification')
  @UseGuards(GuestThrottleGuard)
  async verification(@Body() body: unknown, @Req() req: any, @Res({ passthrough: true }) res: any) {
    return withRetryAfter(res, () => this.guestTickets.requestCode(body, clientIp(req)));
  }

  /** Same handler and budget as `widget/lookup`. */
  @Post('lookup')
  @HttpCode(200)
  @GuestThrottle('verification')
  @UseGuards(GuestThrottleGuard)
  async lookup(@Body() body: unknown) {
    return this.guestTickets.lookup(body);
  }

  /** Same budgets as `widget/tickets`. */
  @Post('tickets')
  @HttpCode(201)
  @GuestThrottle('ticket')
  @UseGuards(GuestThrottleGuard, PublicSubmitThrottleGuard)
  async create(@Body() body: unknown) {
    return this.mobileGuest.create(body);
  }

  @Get('tickets/:token')
  @UseGuards(MobileGuestGrantGuard)
  async show(@Req() req: any) {
    return this.mobileGuest.show(req.guestTicket, req.params.token);
  }

  @Post('tickets/:token/replies')
  @HttpCode(201)
  @GuestThrottle('reply')
  // Throttle first, so requests with a bad grant are counted too.
  @UseGuards(GuestThrottleGuard, MobileGuestGrantGuard)
  async reply(@Body() body: unknown, @Req() req: any) {
    return this.mobileGuest.reply(req.guestTicket, body);
  }
}
