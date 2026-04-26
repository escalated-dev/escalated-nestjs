import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';

/**
 * Verifies the inbound email webhook by a shared-secret header.
 *
 * Host app configures `options.inbound.webhookSecret` and sets a matching
 * value on the provider side (Postmark allows basic-auth; place it behind
 * a proxy that maps basic-auth → `X-Escalated-Inbound-Secret` header).
 * Comparison is constant-time.
 *
 * If no inbound secret is configured, every request is rejected — this
 * prevents accidental exposure of the endpoint.
 */
@Injectable()
export class InboundWebhookSignatureGuard implements CanActivate {
  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const expected = this.options.inbound?.webhookSecret;
    if (!expected) {
      throw new UnauthorizedException('Inbound webhook secret not configured');
    }

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const raw = req.headers['x-escalated-inbound-secret'];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    if (typeof presented !== 'string' || presented.length === 0) {
      throw new UnauthorizedException('Missing inbound webhook signature');
    }

    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid inbound webhook signature');
    }
    return true;
  }
}
