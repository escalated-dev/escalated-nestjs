import { Injectable, NestMiddleware } from '@nestjs/common';

/**
 * `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer` on
 * every answer, errors and 429s included: guest answers carry access
 * credentials. Set before the guards run, so their refusals carry them too.
 */
@Injectable()
export class GuestPrivacyHeadersMiddleware implements NestMiddleware {
  use(_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  }
}
