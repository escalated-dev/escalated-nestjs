import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { GuestAccessService } from '../services/guest-access.service';

/**
 * Admits a mobile guest whose `:token` path segment is an active guest grant
 * (the same grants the widget and guest routes issue). Anything else, whether
 * expired, rotated, revoked, malformed, over-long or a chat visitor token, is
 * a 404, so a probe learns nothing. Sets `request.guestTicket`.
 */
@Injectable()
export class MobileGuestGrantGuard implements CanActivate {
  constructor(private readonly guestAccess: GuestAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ticket = await this.guestAccess.resolve(request.params?.token);
    if (!ticket) throw new NotFoundException('Not found.');
    request.guestTicket = ticket;
    return true;
  }
}
