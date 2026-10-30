import {
  All,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { RequiresAccessFeature } from '../access/access-feature.guard';
import { accessFeatureEnabled } from '../access/access-features';
import {
  forgetTwoFactorSession,
  hasSession,
  regenerateSession,
  takeIntendedUrl,
} from '../access/two-factor-session';
import {
  ESCALATED_OPTIONS,
  type EscalatedModuleOptions,
  type SsoHostUser,
} from '../config/escalated.config';
import { RoleService } from '../services/role.service';
import {
  SsoException,
  SsoService,
  type SsoIdentity,
  type SsoProvider,
} from '../services/sso.service';
import { routeUrl } from '../ui/routes';

const OAUTH_STATE = 'escalatedSsoOauthState';
const OAUTH_PKCE = 'escalatedSsoOauthPkce';
const REFUSED = 'Single sign-on failed. Contact your administrator.';

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * Sign-in through the SSO provider chosen in Admin > Settings > SSO (ADR
 * 2026-10-29-configurable-access-features). Every route answers 404 unless
 * `access.sso` is on and the provider it serves is the chosen one. The
 * routes are for guests: the host's own login stays as it is.
 *
 * Escalated owns no users or sessions, so the host provides
 * `sso.findUserByEmail`, `sso.signIn` and, to create users,
 * `sso.createUser`. Every refusal answers a generic 403 and logs the reason.
 */
@Controller('escalated/sso')
export class SsoController {
  private readonly logger = new Logger('EscalatedSso');

  constructor(
    private readonly sso: SsoService,
    private readonly adapterHost: HttpAdapterHost,
    @Optional() private readonly roles?: RoleService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  @Get('login')
  @RequiresAccessFeature('sso')
  async login(@Req() req: any, @Res() res: any) {
    const provider = await this.sso.provider();
    if (provider === 'none') throw new NotFoundException();
    try {
      if (provider === 'saml') return this.redirect(res, await this.sso.samlLoginUrl(req));
      if (provider === 'jwt') return this.redirect(res, await this.sso.jwtLoginUrl(req));
      if (!hasSession(req)) {
        throw new SsoException('OAuth refused: the host gives requests no session for the state.');
      }
      const { url, state, verifier } = await this.sso.oauthStart(req);
      req.session[OAUTH_STATE] = state;
      req.session[OAUTH_PKCE] = verifier;
      return this.redirect(res, url);
    } catch (error) {
      return this.refuse(res, error);
    }
  }

  @Get('saml/metadata')
  @RequiresAccessFeature('sso')
  async metadata(@Req() req: any, @Res() res: any) {
    await this.require('saml');
    this.send(res, 200, this.sso.samlMetadata(req), 'application/samlmetadata+xml');
  }

  /** The IdP posts here cross-site: the signed, single-use assertion is what authenticates it. */
  @Post('saml/acs')
  @HttpCode(200)
  @RequiresAccessFeature('sso')
  async samlAcs(@Req() req: any, @Res() res: any) {
    await this.require('saml');
    return this.signIn(req, res, () =>
      this.sso.validateSamlResponse(req, String(req.body?.SAMLResponse ?? '')),
    );
  }

  @Get('oauth/callback')
  @RequiresAccessFeature('sso')
  async oauthCallback(@Req() req: any, @Res() res: any) {
    await this.require('oauth');
    const state = hasSession(req) ? String(req.session[OAUTH_STATE] ?? '') : '';
    const verifier = hasSession(req) ? String(req.session[OAUTH_PKCE] ?? '') : '';
    if (hasSession(req)) {
      delete req.session[OAUTH_STATE];
      delete req.session[OAUTH_PKCE];
    }
    const query = req.query ?? {};
    return this.signIn(req, res, async () => {
      if (query.error) {
        throw new SsoException(`OAuth refused: the provider returned ${String(query.error)}.`);
      }
      if (!state || state !== String(query.state ?? '')) {
        throw new SsoException('OAuth refused: missing or mismatched state.');
      }
      if (!query.code || !verifier) {
        throw new SsoException('OAuth refused: no authorization code or PKCE verifier.');
      }
      return this.sso.oauthIdentity(req, String(query.code), verifier);
    });
  }

  @All('jwt/callback')
  @RequiresAccessFeature('sso')
  async jwtCallback(@Req() req: any, @Res() res: any) {
    if (!['GET', 'POST', 'HEAD'].includes(String(req.method).toUpperCase())) {
      throw new NotFoundException();
    }
    await this.require('jwt');
    const token = String(req.body?.jwt ?? req.query?.jwt ?? '');
    return this.signIn(req, res, () => this.sso.validateJwt(token));
  }

  private async require(provider: SsoProvider): Promise<void> {
    if ((await this.sso.provider()) !== provider) throw new NotFoundException();
  }

  private async signIn(req: any, res: any, identify: () => Promise<SsoIdentity>) {
    let user: SsoHostUser;
    try {
      user = await this.resolve(await identify());
      const signIn = this.options?.sso?.signIn;
      if (!signIn) throw new SsoException('SSO refused: the host has not provided sso.signIn.');
      const intended = takeIntendedUrl(req);
      await signIn(req, user);
      await regenerateSession(req);
      // A new sign-in passes the two-factor challenge again, SSO or not.
      forgetTwoFactorSession(req);
      this.logger.log(`Signed in user ${user.id} through ${await this.sso.provider()}.`);
      return this.redirect(res, intended ?? this.home());
    } catch (error) {
      return this.refuse(res, error);
    }
  }

  /**
   * The host user for the identity: matched by email, created only when
   * `sso.createUsers` is on; the asserted role (by slug) replaces the user's
   * Escalated role only with roles & permissions on and `sso.syncRoles`.
   * SSO never grants the host's admin or agent guard.
   */
  private async resolve(identity: SsoIdentity): Promise<SsoHostUser> {
    const hooks = this.options?.sso;
    if (!hooks?.findUserByEmail) {
      throw new SsoException('SSO refused: the host has not provided sso.findUserByEmail.');
    }
    let user = await hooks.findUserByEmail(identity.email);
    if (!user) {
      const create = truthy(hooks.createUsers ?? process.env.ESCALATED_SSO_CREATE_USERS);
      if (!create || !hooks.createUser) {
        throw new SsoException(
          `SSO refused: no user has the email [${identity.email}] and creating users is off.`,
        );
      }
      user = await hooks.createUser({
        email: identity.email,
        name: identity.name || identity.email.split('@')[0],
      });
    }

    const sync = truthy(hooks.syncRoles ?? process.env.ESCALATED_SSO_SYNC_ROLES);
    if (
      identity.role &&
      sync &&
      accessFeatureEnabled(this.options, 'roles_permissions') &&
      this.roles
    ) {
      try {
        await this.roles.assignRole(user.id, identity.role);
      } catch {
        // An unknown role changes nothing.
      }
    }
    return user;
  }

  private home(): string {
    return (
      this.options?.sso?.redirectTo ||
      process.env.ESCALATED_SSO_REDIRECT_TO ||
      routeUrl('escalated.agent.dashboard')
    );
  }

  private redirect(res: any, url: string) {
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(res, 'Location', url);
    adapter.reply(res, '', 302);
  }

  private send(res: any, status: number, body: string, type: string) {
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(res, 'Content-Type', type);
    adapter.reply(res, body, status);
  }

  private refuse(res: any, error: unknown) {
    if (!(error instanceof SsoException)) {
      this.logger.error(`SSO sign-in failed: ${(error as Error)?.message ?? error}`);
    } else {
      this.logger.warn(error.message);
    }
    return this.send(res, 403, REFUSED, 'text/plain; charset=utf-8');
  }
}
