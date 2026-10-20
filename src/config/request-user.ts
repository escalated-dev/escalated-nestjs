import { UnauthorizedException } from '@nestjs/common';
import type { UserId } from './user-id-column';

function present(id: unknown): id is UserId {
  return (typeof id === 'number' || typeof id === 'string') && id !== '' && String(id) !== '0';
}

/**
 * The acting host user of a request: `req.user.id` set by the host guard, or
 * `req.apiUserId` set by the API token guard. Fails closed with 401 when the
 * host guard admitted the request without identifying a user, instead of
 * acting as some default user.
 */
export function requireUserId(req: any): UserId {
  const id = present(req?.user?.id) ? req.user.id : req?.apiUserId;
  if (!present(id)) {
    throw new UnauthorizedException('Host authentication must identify the current user');
  }
  return id;
}
