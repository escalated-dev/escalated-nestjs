import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Or, Repository } from 'typeorm';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Secret, TOTP } from 'otpauth';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import { AgentProfile } from '../entities/agent-profile.entity';
import { TwoFactor } from '../entities/two-factor.entity';
import { accessFeatureEnabled } from '../access/access-features';
import { SecretBox } from '../access/secret-box';
import { SettingsService } from './settings.service';

/** TOTP as RFC 6238 and escalated-laravel: SHA-1, 6 digits, 30-second steps. */
const PERIOD = 30;
const DIGITS = 6;
/** Steps of clock drift accepted either side of now. */
export const TWO_FACTOR_WINDOW = 1;

function truthy(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * Two-factor authentication (ADR 2026-10-29-configurable-access-features):
 * TOTP through the `otpauth` library, single-use recovery codes, and the
 * enrolment a staff user keeps in `escalated_two_factor`, sealed at rest.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger('EscalatedTwoFactor');
  private box?: SecretBox;

  constructor(
    @InjectRepository(TwoFactor) private readonly enrolments: Repository<TwoFactor>,
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
    @Optional() private readonly settings?: SettingsService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  /** Whether two-factor is switched on for this install. */
  enabled(): boolean {
    return accessFeatureEnabled(this.options, 'two_factor');
  }

  /**
   * Whether staff must enrol: the `two_factor_required` setting once an admin
   * has saved it, else `twoFactor.required` / `ESCALATED_TWO_FACTOR_REQUIRED`.
   * Only while the switch is on.
   */
  async required(): Promise<boolean> {
    if (!this.enabled()) return false;
    const configured =
      this.options?.twoFactor?.required ?? truthy(process.env.ESCALATED_TWO_FACTOR_REQUIRED);
    if (!this.settings) return configured;
    try {
      const saved = await this.settings.get('two_factor_required');
      return saved === null || saved === undefined || saved === '' ? configured : truthy(saved);
    } catch {
      return configured;
    }
  }

  /** A random 32-character base32 secret (160 bits, the RFC 4226 recommendation). */
  generateSecret(): string {
    return new Secret({ size: 20 }).base32;
  }

  /** Eight random single-use recovery codes. */
  generateRecoveryCodes(): string[] {
    const part = () => randomBytes(4).toString('hex').toUpperCase();
    return Array.from({ length: 8 }, () => `${part()}-${part()}`);
  }

  /** The `otpauth://` URI an authenticator app reads. */
  qrUri(secret: string, label: string): string {
    const issuer =
      this.options?.twoFactor?.issuer ||
      process.env.ESCALATED_TWO_FACTOR_ISSUER ||
      this.options?.appName ||
      'Escalated';
    return this.totp(secret, label, issuer).toString();
  }

  /**
   * The time step a code is valid for right now (one step of drift either
   * side), or null. No replay check: see `verifyAndConsume`.
   */
  codeStep(secret: string, code: string, now = Date.now()): number | null {
    const token = String(code ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(token)) return null;
    const delta = this.totp(secret).validate({
      token,
      timestamp: now,
      window: TWO_FACTOR_WINDOW,
    });
    return delta === null ? null : Math.floor(now / 1000 / PERIOD) + delta;
  }

  /**
   * Checks a code for an enrolment and records its time step, refusing a step
   * at or before the last one accepted, so a code works once.
   */
  async verifyAndConsume(enrolment: TwoFactor, code: string): Promise<boolean> {
    const step = this.codeStep(this.open(enrolment.secret), code);
    if (step === null) return false;
    if (enrolment.lastUsedStep !== null && enrolment.lastUsedStep !== undefined) {
      if (step <= Number(enrolment.lastUsedStep)) return false;
    }
    // Only advance from the step read, so two requests with one code cannot both pass.
    const result = await this.enrolments.update(
      { id: enrolment.id, lastUsedStep: Or(IsNull(), LessThan(step)) },
      { lastUsedStep: step },
    );
    if (result.affected === 0) return false;
    enrolment.lastUsedStep = step;
    return true;
  }

  /** Uses a recovery code: true, and it is removed, when it matches one. */
  async useRecoveryCode(enrolment: TwoFactor, code: string): Promise<boolean> {
    const given = Buffer.from(
      String(code ?? '')
        .trim()
        .toUpperCase(),
    );
    if (!given.length) return false;
    const codes = this.recoveryCodes(enrolment);
    const index = codes.findIndex((candidate) => {
      const expected = Buffer.from(candidate.toUpperCase());
      return expected.length === given.length && timingSafeEqual(expected, given);
    });
    if (index < 0) return false;
    codes.splice(index, 1);
    enrolment.recoveryCodes = this.seal(JSON.stringify(codes));
    await this.enrolments.update(enrolment.id, { recoveryCodes: enrolment.recoveryCodes });
    return true;
  }

  /** The user's unused recovery codes. */
  recoveryCodes(enrolment: TwoFactor): string[] {
    if (!enrolment.recoveryCodes) return [];
    try {
      const codes = JSON.parse(this.open(enrolment.recoveryCodes));
      return Array.isArray(codes) ? codes.map(String) : [];
    } catch {
      return [];
    }
  }

  /**
   * The user's confirmed enrolment, or null. An enrolment made on the agent
   * profile before this table existed is moved here, sealed, on first use.
   */
  async confirmedFor(userId: UserId | null | undefined): Promise<TwoFactor | null> {
    if (userId === null || userId === undefined || userId === '') return null;
    const found = await this.enrolments.findOne({ where: { userId, confirmedAt: Not(IsNull()) } });
    if (found) return found;
    return this.adoptLegacy(userId);
  }

  async pendingFor(userId: UserId): Promise<TwoFactor | null> {
    return this.enrolments.findOne({ where: { userId, confirmedAt: IsNull() } });
  }

  /**
   * Starts an enrolment: a pending secret and recovery codes. Refused while a
   * confirmed one exists (disable it first).
   */
  async setup(
    userId: UserId,
    label: string,
  ): Promise<{ qr_uri: string; recovery_codes: string[] }> {
    if (await this.confirmedFor(userId)) {
      throw new BadRequestException(
        'Two-factor authentication is already enabled. Disable it first to set it up again.',
      );
    }
    await this.enrolments.delete({ userId, confirmedAt: IsNull() });
    const secret = this.generateSecret();
    const recoveryCodes = this.generateRecoveryCodes();
    await this.enrolments.save(
      this.enrolments.create({
        userId,
        secret: this.seal(secret),
        recoveryCodes: this.seal(JSON.stringify(recoveryCodes)),
        confirmedAt: null,
        lastUsedStep: null,
      }),
    );
    return { qr_uri: this.qrUri(secret, label), recovery_codes: recoveryCodes };
  }

  /**
   * Confirms the pending enrolment with a first code. Returns its recovery
   * codes, or null when there is no pending enrolment or the code is wrong.
   */
  async confirm(userId: UserId, code: string): Promise<{ recovery_codes: string[] } | null> {
    const pending = await this.pendingFor(userId);
    if (!pending || !(await this.verifyAndConsume(pending, code))) return null;
    await this.enrolments.update(pending.id, { confirmedAt: new Date() });
    return { recovery_codes: this.recoveryCodes(pending) };
  }

  /** Removes the user's enrolment (their own, or an admin's reset for a lost device). */
  async disable(userId: UserId): Promise<void> {
    await this.enrolments.delete({ userId });
    const profile = await this.profiles.findOne({ where: { userId } });
    if (profile?.twoFactorSecret || profile?.twoFactorEnabled) {
      await this.profiles.update(profile.id, {
        twoFactorEnabled: false,
        twoFactorSecret: null as any,
        twoFactorRecoveryCodes: null as any,
      });
    }
  }

  /** An admin's reset of a user's enrolment, as Laravel's `escalated:two-factor:reset`. */
  async reset(userId: UserId): Promise<void> {
    await this.disable(userId);
  }

  /** @deprecated Use `confirmedFor`. */
  async isEnabled(userId: UserId): Promise<boolean> {
    return !!(await this.confirmedFor(userId));
  }

  private async adoptLegacy(userId: UserId): Promise<TwoFactor | null> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile?.twoFactorEnabled || !profile.twoFactorSecret) return null;
    const enrolment = await this.enrolments.save(
      this.enrolments.create({
        userId,
        secret: this.seal(profile.twoFactorSecret),
        recoveryCodes: this.seal(JSON.stringify(profile.twoFactorRecoveryCodes ?? [])),
        confirmedAt: new Date(),
        lastUsedStep: null,
      }),
    );
    await this.profiles.update(profile.id, {
      twoFactorEnabled: false,
      twoFactorSecret: null as any,
      twoFactorRecoveryCodes: null as any,
    });
    this.logger.log(`Moved user ${userId}'s two-factor enrolment to escalated_two_factor.`);
    return enrolment;
  }

  private totp(secret: string, label = 'Escalated', issuer = 'Escalated'): TOTP {
    return new TOTP({
      issuer,
      label,
      algorithm: 'SHA1',
      digits: DIGITS,
      period: PERIOD,
      secret: Secret.fromBase32(secret),
    });
  }

  private secretBox(): SecretBox {
    if (!this.box) {
      const key =
        this.options?.twoFactor?.secret ||
        process.env.ESCALATED_TWO_FACTOR_SECRET ||
        this.options?.guestAccess?.secret ||
        process.env.ESCALATED_GUEST_ACCESS_SECRET ||
        this.options?.inbound?.replySecret;
      if (!key) {
        throw new Error(
          'Two-factor authentication needs a key to seal secrets: set twoFactor.secret or ESCALATED_TWO_FACTOR_SECRET.',
        );
      }
      this.box = new SecretBox(key);
    }
    return this.box;
  }

  private seal(value: string): string {
    return this.secretBox().seal(value);
  }

  private open(value: string): string {
    return this.secretBox().open(value);
  }
}
