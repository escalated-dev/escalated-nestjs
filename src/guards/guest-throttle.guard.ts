import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerStorage,
  ThrottlerException,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';

export type GuestThrottleScope = 'ticket' | 'reply';

export const GUEST_THROTTLE_SCOPE = 'escalated:guest-throttle-scope';

/** Marks a route as a guest endpoint counted against the given per-IP bucket. */
export const GuestThrottle = (scope: GuestThrottleScope) =>
  SetMetadata(GUEST_THROTTLE_SCOPE, scope);

const WINDOW_MS = 60_000;
const DEFAULT_LIMITS: Record<GuestThrottleScope, number> = { ticket: 5, reply: 10 };

/**
 * Per-client-IP rate limit for the unauthenticated guest endpoints. Every
 * accepted guest ticket or reply writes rows and sends outbound mail, so an
 * uncapped endpoint lets anyone flood the helpdesk and the mail provider.
 *
 * Limits come from `EscalatedModuleOptions.guestRateLimit` (defaults: 5 ticket
 * submissions and 10 replies per IP per minute). Counters are kept in
 * `guestRateLimit.storage` when the host supplies a shared store, otherwise in
 * the in-memory `@nestjs/throttler` storage. Apply it before `GuestAccessGuard` so requests
 * with a wrong guest token are counted too.
 */
@Injectable()
export class GuestThrottleGuard implements CanActivate {
  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    private readonly reflector: Reflector,
    @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.get<GuestThrottleScope | undefined>(
      GUEST_THROTTLE_SCOPE,
      context.getHandler(),
    );
    const config = this.options.guestRateLimit ?? {};
    if (!scope || config.enabled === false) {
      return true;
    }

    const limit =
      (scope === 'ticket' ? config.ticketsPerMinute : config.repliesPerMinute) ??
      DEFAULT_LIMITS[scope];

    const http = context.switchToHttp();
    const req = http.getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const key = `escalated:guest:${scope}:${ip}`;

    const storage = config.storage ?? this.storage;
    const { isBlocked, timeToBlockExpire } = await storage.increment(
      key,
      WINDOW_MS,
      limit,
      WINDOW_MS,
      `escalated-guest-${scope}`,
    );

    if (isBlocked) {
      http
        .getResponse<{ header?: (name: string, value: unknown) => void }>()
        .header?.('Retry-After', timeToBlockExpire);
      throw new ThrottlerException('Too many requests. Please try again later.');
    }

    return true;
  }
}
