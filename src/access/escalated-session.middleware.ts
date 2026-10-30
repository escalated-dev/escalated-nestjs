import { Inject, Injectable, Logger, NestMiddleware, Optional } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { accessFeatureEnabled } from './access-features';
import { hasSession, restoreSsoSessionUser } from './two-factor-session';

type Handler = (req: any, res: any, next: (error?: unknown) => void) => void;

/**
 * The key for Escalated's own session cookie: `session.secret`, else
 * `ESCALATED_SESSION_SECRET`, else derived from the two-factor sealing key
 * chain (`twoFactor.secret`, `ESCALATED_TWO_FACTOR_SECRET`,
 * `guestAccess.secret`, `ESCALATED_GUEST_ACCESS_SECRET`,
 * `inbound.replySecret`), so an install that set any of those needs nothing
 * more.
 */
export function escalatedSessionSecret(options: EscalatedModuleOptions): string | null {
  const configured = options.session ? options.session.secret : undefined;
  if (configured) return configured;
  if (process.env.ESCALATED_SESSION_SECRET) return process.env.ESCALATED_SESSION_SECRET;
  const key =
    options.twoFactor?.secret ||
    process.env.ESCALATED_TWO_FACTOR_SECRET ||
    options.guestAccess?.secret ||
    process.env.ESCALATED_GUEST_ACCESS_SECRET ||
    options.inbound?.replySecret;
  return key ? createHmac('sha256', key).update('escalated-session').digest('hex') : null;
}

/** Escalated's routes live under `/escalated/` (after any global prefix the host set). */
function isEscalatedPath(req: any): boolean {
  const url = String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
  return /(^|\/)escalated(\/|$)/.test(url);
}

/**
 * Gives Escalated's routes a session when the host mounts none, so two-factor
 * and SSO work out of the box (ADR 2026-10-29-configurable-access-features).
 *
 * - The host's session wins: if `req.session` is already there (express-session,
 *   cookie-session, passport's), nothing is mounted.
 * - Otherwise, while two-factor or SSO is on, `express-session` is installed,
 *   `session` is not `false` and a key is configured (see
 *   {@link escalatedSessionSecret}), express-session is mounted on Escalated's
 *   routes only, with cookie `escalated.sid` (HttpOnly, SameSite=Lax, saved
 *   only once something is stored in it).
 * - A user SSO signed in to the session (no passport, no `sso.signIn`) becomes
 *   `req.user` on Escalated's routes when nothing else set one.
 */
@Injectable()
export class EscalatedSessionMiddleware implements NestMiddleware {
  private readonly logger = new Logger('EscalatedSession');
  private handler?: Handler | null;

  constructor(
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  use(req: any, res: any, next: (error?: unknown) => void): void {
    if (!isEscalatedPath(req)) return next();
    const done = () => {
      restoreSsoSessionUser(req);
      next();
    };
    if (hasSession(req)) return done();
    const handler = this.sessionHandler();
    if (!handler) return done();
    handler(req, res, (error?: unknown) => (error ? next(error) : done()));
  }

  private sessionHandler(): Handler | null {
    if (this.handler !== undefined) return this.handler;
    this.handler = this.build();
    return this.handler;
  }

  private build(): Handler | null {
    const options = this.options ?? {};
    if (options.session === false) return null;
    if (!accessFeatureEnabled(options, 'two_factor') && !accessFeatureEnabled(options, 'sso')) {
      return null;
    }
    let factory: (config: Record<string, unknown>) => Handler;
    try {
      // An optional peer: only hosts that want Escalated's own session install it.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      factory = require('express-session');
    } catch {
      return null;
    }
    const secret = escalatedSessionSecret(options);
    if (!secret) {
      this.logger.warn(
        'No session on the host and no key for one: set session.secret or ESCALATED_SESSION_SECRET (or twoFactor.secret) so Escalated can keep a session.',
      );
      return null;
    }
    const config = options.session || {};
    return factory({
      name: config.name ?? 'escalated.sid',
      secret,
      store: config.store,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', path: '/', ...(config.cookie ?? {}) },
    });
  }
}
