import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;

/**
 * Per-email rate limit for unauthenticated public ticket submission.
 *
 * If `request.body.email` is absent (legacy requesterId path), the guard is
 * a no-op and defers to the standard ThrottlerGuard already applied at the
 * module level.
 *
 * NOTE: in-memory store. Suitable for single-instance deployments and for
 * tests. A multi-instance deployment must swap the backing store for Redis
 * (or equivalent). See the README in a later phase.
 */
@Injectable()
export class PublicSubmitThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ body?: Record<string, unknown> }>();
    const raw = req?.body?.email;
    if (typeof raw !== 'string' || raw.length === 0) {
      return true;
    }
    const key = raw.trim().toLowerCase();
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    const existing = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (existing.length >= MAX_PER_WINDOW) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many submissions from this email. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}
