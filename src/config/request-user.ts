import { Logger, UnauthorizedException } from '@nestjs/common';
import type { UserId } from './user-id-column';

function present(id: unknown): id is UserId {
  return (typeof id === 'number' || typeof id === 'string') && id !== '' && String(id) !== '0';
}

const logger = new Logger('EscalatedSetup');
const warned = new Set<string>();

/**
 * Why a request admitted by the host has no acting user, naming what the host
 * must provide: Escalated's user contract is `req.user.id`, the host user's
 * primary key (a number or a string), set by the host's guard or middleware.
 */
export function missingUserMessage(req: any): string {
  const user = req?.user;
  const found =
    user && typeof user === 'object'
      ? `req.user is set but has no usable id (its keys: ${
          Object.keys(user).slice(0, 10).join(', ') || 'none'
        })`
      : 'req.user is not set';
  return (
    `Escalated could not identify the signed-in user: ${found}. ` +
    'Escalated reads the acting user from req.user.id, your user primary key (a number or a ' +
    'string). Set req.user = { id, name?, email? } in your adminGuard, agentGuard and ' +
    'customerGuard (or in middleware that runs before them); a passport strategy that ' +
    'returns { sub } or { userId } must map it to id. See docs/getting-started.md, ' +
    '"Route guards".'
  );
}

/** Logs the setup problem once per distinct message, so it reaches the host's logs. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  logger.warn(message);
}

/**
 * The acting host user of a request: `req.user.id` set by the host guard, or
 * `req.apiUserId` set by the API token guard. Fails closed with 401 when the
 * host guard admitted the request without identifying a user, instead of
 * acting as some default user, with a message that names the contract.
 */
export function requireUserId(req: any): UserId {
  const id = present(req?.user?.id) ? req.user.id : req?.apiUserId;
  if (!present(id)) {
    const message = missingUserMessage(req);
    warnOnce(message);
    throw new UnauthorizedException(message);
  }
  return id;
}
