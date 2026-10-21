import { HttpException, HttpStatus } from '@nestjs/common';

/** The client IP the guest budgets count (`req.ip`; configure `trust proxy`). */
export function clientIp(req: any): string {
  return req?.ip ?? req?.socket?.remoteAddress ?? 'unknown';
}

/** Runs `fn`, adding `Retry-After` to a 429 it throws. */
export async function withRetryAfter<T>(res: any, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
      const retryAfter = (error.getResponse() as { retryAfter?: number })?.retryAfter;
      if (retryAfter) res?.header?.('Retry-After', String(retryAfter));
    }
    throw error;
  }
}
