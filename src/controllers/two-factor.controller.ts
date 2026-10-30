import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ThrottlerException,
  InjectThrottlerStorage,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AccessControlService } from '../access/access-control.service';
import { RequiresAccessFeature } from '../access/access-feature.guard';
import { TwoFactorRoute } from '../access/two-factor-gate';
import {
  flashToSession,
  hasSession,
  markTwoFactorPassed,
  regenerateSession,
  takeIntendedUrl,
  twoFactorPassed,
} from '../access/two-factor-session';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { ESCALATED_ROUTE_GROUP, EscalatedStaffGuard } from '../guards/escalated-route.guard';
import { TwoFactorService } from '../services/two-factor.service';
import { back, inertia, redirect } from '../ui/inertia';
import { EscalatedUi, UiValidationException } from '../ui/inertia.interceptor';
import { isScriptedRequest, wantsPage } from '../ui/request';
import { routeUrl } from '../ui/routes';

/** Verify attempts per user per minute (Laravel's `escalated-two-factor` limiter). */
const VERIFY_LIMIT = 5;
const VERIFY_WINDOW_MS = 60_000;

function origin(request: any): string {
  const protocol = request?.protocol ?? (request?.secure ? 'https' : 'http');
  return `${protocol}://${request?.headers?.host ?? 'localhost'}`;
}

/**
 * Two-factor authentication (ADR 2026-10-29-configurable-access-features),
 * 404 while `access.twoFactor` is off.
 *
 * Enrolment (`Escalated/Admin/Settings/TwoFactor`) is about the signed-in
 * user's own account, so every staff user reaches it, not only admins. The
 * challenge (`Escalated/Auth/TwoFactorChallenge`) sits between the host's
 * login and the admin and agent areas. Browser and Inertia visits get the
 * screens; API clients get JSON.
 */
@UseGuards(EscalatedStaffGuard)
@EscalatedUi()
@Controller('escalated')
export class TwoFactorController {
  private readonly logger = new Logger('EscalatedTwoFactor');

  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly access: AccessControlService,
    @InjectThrottlerStorage() private readonly throttle: ThrottlerStorage,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  // ---- Enrolment ------------------------------------------------------------

  @Get('admin/settings/two-factor')
  @RequiresAccessFeature('two_factor')
  @TwoFactorRoute('enrolment')
  async index(@Req() req: any) {
    const userId = this.userId(req);
    const props = {
      enabled: !!(await this.twoFactor.confirmedFor(userId)),
      pending: !!(await this.twoFactor.pendingFor(userId)),
      required: await this.twoFactor.required(),
    };
    return this.screen(req) ? inertia('Escalated/Admin/Settings/TwoFactor', props) : props;
  }

  @Post('admin/settings/two-factor/setup')
  @HttpCode(200)
  @RequiresAccessFeature('two_factor')
  @TwoFactorRoute('enrolment')
  async setup(@Req() req: any) {
    this.scripted(req);
    const userId = this.userId(req);
    const label = String(req?.user?.email ?? req?.user?.name ?? `user-${userId}`);
    const data = await this.twoFactor.setup(userId, label);
    if (!this.screen(req)) return data;
    flashToSession(req, { two_factor_setup: data });
    return back(routeUrl('escalated.admin.two-factor.index'));
  }

  @Post('admin/settings/two-factor/confirm')
  @HttpCode(200)
  @RequiresAccessFeature('two_factor')
  @TwoFactorRoute('enrolment')
  async confirm(@Body() body: any, @Req() req: any) {
    this.scripted(req);
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (code.length !== 6) {
      throw new UiValidationException({ code: 'The code must be 6 characters.' });
    }
    const userId = this.userId(req);
    if (!(await this.twoFactor.pendingFor(userId))) {
      throw new UiValidationException({ code: 'No pending two-factor setup found.' });
    }
    const confirmed = await this.twoFactor.confirm(userId, code);
    if (!confirmed) throw new UiValidationException({ code: 'Invalid verification code.' });

    // The code just entered proves the second factor for this session.
    markTwoFactorPassed(req, userId);
    if (!this.screen(req)) return { enabled: true, ...confirmed };
    flashToSession(req, { two_factor_confirmed: confirmed });
    return back(routeUrl('escalated.admin.two-factor.index'), {
      success: 'Two-factor authentication enabled.',
    });
  }

  @Post('admin/settings/two-factor/disable')
  @HttpCode(200)
  @RequiresAccessFeature('two_factor')
  @TwoFactorRoute('enrolment')
  async disable(@Req() req: any) {
    this.scripted(req);
    await this.twoFactor.disable(this.userId(req));
    if (!this.screen(req)) return { enabled: false };
    return back(routeUrl('escalated.admin.two-factor.index'), {
      success: 'Two-factor authentication disabled.',
    });
  }

  // ---- Challenge ------------------------------------------------------------

  @Get('two-factor/challenge')
  @RequiresAccessFeature('two_factor')
  @TwoFactorRoute('challenge')
  async challenge(@Req() req: any) {
    const userId = this.userId(req);
    if (!(await this.twoFactor.confirmedFor(userId)) || twoFactorPassed(req, userId)) {
      return this.leave(req);
    }
    const props = { action: origin(req) + routeUrl('escalated.two-factor.verify'), error: '' };
    return this.screen(req) ? inertia('Escalated/Auth/TwoFactorChallenge', props) : props;
  }

  @Post('two-factor/challenge')
  @HttpCode(200)
  @RequiresAccessFeature('two_factor')
  @TwoFactorRoute('challenge')
  async verify(@Body() body: any, @Req() req: any) {
    const userId = this.userId(req);
    await this.limit(req, userId);

    const enrolment = await this.twoFactor.confirmedFor(userId);
    if (!enrolment) return this.leave(req);
    if (!hasSession(req)) {
      throw new ForbiddenException(
        'Two-factor authentication needs a session: mount a session middleware on the host (req.session), or install express-session and set a key (session.secret, ESCALATED_SESSION_SECRET or twoFactor.secret) so Escalated mounts its own.',
      );
    }

    const code = typeof body?.code === 'string' ? body.code : '';
    const recovery = typeof body?.recovery_code === 'string' ? body.recovery_code : '';
    if (!code.trim() && !recovery.trim()) {
      throw new UiValidationException({ code: 'The code field is required.' });
    }
    if (code.length > 16 || recovery.length > 64) {
      throw new UiValidationException(
        recovery
          ? { recovery_code: 'That recovery code is not valid.' }
          : { code: 'That code is not valid.' },
      );
    }

    const usingRecovery = recovery.trim() !== '';
    const passed = usingRecovery
      ? await this.twoFactor.useRecoveryCode(enrolment, recovery)
      : await this.twoFactor.verifyAndConsume(enrolment, code);
    if (!passed) {
      this.logger.log(
        `Two-factor challenge failed for user ${userId} from ${req?.ip ?? 'unknown'}`,
      );
      throw new UiValidationException(
        usingRecovery
          ? { recovery_code: 'That recovery code is not valid.' }
          : { code: 'That code is not valid.' },
      );
    }

    const intended = takeIntendedUrl(req);
    await regenerateSession(req);
    markTwoFactorPassed(req, userId);
    return this.leave(req, intended);
  }

  // ---- Helpers --------------------------------------------------------------

  private userId(req: any) {
    const id = this.access.userId(req);
    if (!id) throw new ForbiddenException('Host authentication must identify the current user');
    return id;
  }

  private screen(req: any): boolean {
    return wantsPage(this.options, req);
  }

  /** A screen's state-changing post must come from a page script (no cross-site forms). */
  private scripted(req: any): void {
    if (this.screen(req) && !isScriptedRequest(req)) {
      throw new ForbiddenException('Screen forms must be sent by the Escalated client');
    }
  }

  /** On to the page the user asked for, else their home screen. */
  private leave(req: any, intended?: string | null) {
    const target =
      intended ??
      takeIntendedUrl(req) ??
      (req?.[ESCALATED_ROUTE_GROUP] === 'agent'
        ? routeUrl('escalated.agent.dashboard')
        : routeUrl('escalated.admin.reports'));
    return this.screen(req) ? redirect(target) : { redirect: target };
  }

  private async limit(req: any, userId: unknown): Promise<void> {
    const { isBlocked, timeToBlockExpire } = await this.throttle.increment(
      `escalated:two-factor:${String(userId ?? req?.ip ?? 'unknown')}`,
      VERIFY_WINDOW_MS,
      VERIFY_LIMIT,
      VERIFY_WINDOW_MS,
      'escalated-two-factor',
    );
    if (isBlocked) {
      req?.res?.header?.('Retry-After', timeToBlockExpire);
      throw new ThrottlerException('Too many attempts. Please try again later.');
    }
  }
}
