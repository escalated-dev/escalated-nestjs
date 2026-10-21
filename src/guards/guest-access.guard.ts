import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { GuestAccessService } from '../services/guest-access.service';

/** The guest credential on a request: `Authorization: Bearer`, `X-Guest-Token` or `?guest_token=`. */
export function guestCredential(request: any): string | null {
  const auth = String(request.headers?.authorization ?? '');
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  const token = bearer ?? request.headers?.['x-guest-token'] ?? request.query?.guest_token;
  return typeof token === 'string' && token !== '' ? token : null;
}

/**
 * Admits a guest to one ticket. The credential is an expiring grant from
 * verified guest access, or, only with `guestAccess.legacyTokens`, the
 * permanent token issued before it. The route's `:ticket` (or legacy `:id`)
 * must name the same ticket, by reference or id. Sets `request.guestTicket`.
 */
@Injectable()
export class GuestAccessGuard implements CanActivate {
  constructor(private readonly guestAccess: GuestAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = guestCredential(request);
    const named = String(
      request.params?.ticket ?? request.params?.ticketId ?? request.params?.id ?? '',
    );

    if (!token || !named) {
      throw new ForbiddenException('Guest access token required');
    }

    const ticket = await this.guestAccess.ticketForToken(token);
    if (!ticket || (named !== ticket.referenceNumber && named !== String(ticket.id))) {
      throw new ForbiddenException('This link has expired. Verify your email for a new one.');
    }

    request.guestTicket = ticket;
    return true;
  }
}
