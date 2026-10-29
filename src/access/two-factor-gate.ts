import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { TwoFactorService } from '../services/two-factor.service';
import { acceptsHtml, isInertiaRequest, requestUrl } from '../ui/request';
import { routeUrl } from '../ui/routes';
import { AccessControlService } from './access-control.service';
import { hasSession, rememberIntendedUrl, twoFactorPassed } from './two-factor-session';

export const TWO_FACTOR_ROUTE = 'escalated:twoFactorRoute';

/**
 * Marks the two-factor routes themselves: `challenge` is reachable before
 * the challenge is passed; `enrolment` is reachable before enrolling when
 * two-factor is required (but still challenges an enrolled user first).
 */
export const TwoFactorRoute = (kind: 'challenge' | 'enrolment') =>
  SetMetadata(TWO_FACTOR_ROUTE, kind);

/**
 * Sends a staff user to the challenge (or to enrol): a redirect for a browser
 * or Inertia visit, `403 {two_factor_required: true}` for an API client.
 */
export class TwoFactorRedirectException extends ForbiddenException {
  constructor(
    readonly location: string,
    message: string,
  ) {
    super({ message, two_factor_required: true });
  }
}

@Catch(TwoFactorRedirectException)
export class TwoFactorRedirectFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: TwoFactorRedirectException, host: ArgumentsHost): void {
    const adapter = this.adapterHost.httpAdapter;
    const request = host.switchToHttp().getRequest();
    const response = host.switchToHttp().getResponse();
    const method = String(request?.method ?? 'GET').toUpperCase();

    if (isInertiaRequest(request) || acceptsHtml(request)) {
      if (method === 'GET') rememberIntendedUrl(request, requestUrl(request));
      adapter.setHeader(response, 'Location', exception.location);
      adapter.reply(response, '', method === 'GET' ? 302 : 303);
      return;
    }
    adapter.reply(response, exception.getResponse(), 403);
  }
}

/**
 * The challenge between the host's login and the admin and agent areas (ADR
 * 2026-10-29-configurable-access-features), run by the area guards once the
 * host guard has admitted the request. While two-factor is on:
 *
 * - a staff user with a confirmed enrolment who has not passed the challenge
 *   in this session is sent to it;
 * - while two-factor is required, a staff user without one is sent to enrol
 *   and can reach nothing but the enrolment routes.
 *
 * API token requests are not session-based and are not challenged.
 */
@Injectable()
export class TwoFactorGate {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly access: AccessControlService,
  ) {}

  async check(context: ExecutionContext): Promise<void> {
    if (!this.twoFactor.enabled()) return;
    const request = context.switchToHttp().getRequest();
    if (request?.apiToken) return;
    const userId = this.access.userId(request);
    if (!userId) return;

    const kind =
      Reflect.getMetadata(TWO_FACTOR_ROUTE, context.getHandler()) ??
      Reflect.getMetadata(TWO_FACTOR_ROUTE, context.getClass());
    if (kind === 'challenge') return;

    if (await this.twoFactor.confirmedFor(userId)) {
      if (!hasSession(request)) {
        throw new ForbiddenException(
          'Two-factor authentication needs a session: add a session middleware (req.session, e.g. express-session) to the host.',
        );
      }
      if (twoFactorPassed(request, userId)) return;
      throw new TwoFactorRedirectException(
        routeUrl('escalated.two-factor.challenge'),
        'Two-factor authentication is required.',
      );
    }

    if (kind !== 'enrolment' && (await this.twoFactor.required())) {
      throw new TwoFactorRedirectException(
        routeUrl('escalated.admin.two-factor.index'),
        'Set up two-factor authentication to continue.',
      );
    }
  }
}
