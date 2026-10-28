import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import { IsNull, LessThan, Repository } from 'typeorm';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { GuestVerification } from '../entities/guest-verification.entity';
import { Ticket } from '../entities/ticket.entity';
import { Contact } from '../entities/contact.entity';
import { EmailService } from './email/email.service';

/*
 * Verified guest access, ported from escalated-laravel (GuestEmailVerification
 * and GuestAccess; see docs/guest-access.md).
 *
 * A guest proves they can read a mailbox with an eight-digit code emailed to
 * it (`challenge`, then `consume`). A proven ticket gets an expiring grant
 * (`issue`): an opaque, encrypted token whose random nonce is stored on the
 * ticket only as a SHA-256 hash. Issuing again rotates the nonce, which revokes
 * earlier grants.
 */

export const GUEST_PURPOSES = ['ticket', 'chat', 'lookup'] as const;
export type GuestPurpose = (typeof GUEST_PURPOSES)[number];

export const CODE_TTL_SECONDS = 600;
export const MAX_ATTEMPTS = 5;
export const INVALID_CODE = 'This code is invalid, expired or already used. Request a new code.';
const HOUR_MS = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEGACY_TOKEN = /^[A-Za-z0-9-]{16,255}$/;

/** 422 with `errors.verification_code`, the shape the shared forms read. */
export class InvalidGuestCode extends UnprocessableEntityException {
  constructor() {
    super({ message: INVALID_CODE, errors: { verification_code: [INVALID_CODE] } });
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function same(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function clamp(value: unknown, fallback: number, low: number, high: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(low, Math.min(high, Math.floor(number)));
}

/** Lifetime of guest and chat grants: `guestAccess.ttlMinutes`, default 1440, 5 min .. 7 days. */
export function guestAccessTtlMinutes(options?: EscalatedModuleOptions | null): number {
  return clamp(options?.guestAccess?.ttlMinutes, 1440, 5, 10080);
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

export interface GuestGrant {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class GuestAccessService {
  private readonly logger = new Logger(GuestAccessService.name);
  private fallbackSecret: string | null = null;

  constructor(
    @InjectRepository(GuestVerification)
    private readonly verifications: Repository<GuestVerification>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions,
    @InjectThrottlerStorage() private readonly throttler: ThrottlerStorage,
    @Optional() private readonly email?: EmailService,
  ) {}

  private get config() {
    return this.options.guestAccess ?? {};
  }

  legacyTokensEnabled(): boolean {
    return this.config.legacyTokens === true;
  }

  ttlMinutes(): number {
    return guestAccessTtlMinutes(this.options);
  }

  private secret(): string {
    const configured =
      this.config.secret ||
      process.env.ESCALATED_GUEST_ACCESS_SECRET ||
      this.options.inbound?.replySecret;
    if (configured) return configured;
    if (!this.fallbackSecret) {
      this.logger.warn(
        'guestAccess.secret is not set: using a random key, so guest grants end with this process.',
      );
      this.fallbackSecret = randomBytes(32).toString('hex');
    }
    return this.fallbackSecret;
  }

  /** A keyed digest (the guest access secret) of `value`. */
  digest(value: string): string {
    return createHmac('sha256', this.secret()).update(`escalated-guest:${value}`).digest('hex');
  }

  emailDigest(email: unknown): string {
    return this.digest(normalizeEmail(email));
  }

  isValidEmail(email: unknown): boolean {
    const normalized = normalizeEmail(email);
    return normalized.length > 0 && normalized.length <= 255 && EMAIL.test(normalized);
  }

  // -------------------------------------------------------------------------
  // Email codes
  // -------------------------------------------------------------------------

  /**
   * Email a one-time code for `purpose` and return the verification id.
   * Delivery is budgeted per mailbox and client IP, so one client cannot use
   * up the owner's budget, and per mailbox across clients.
   */
  async challenge(rawEmail: unknown, purpose: unknown, clientIp: string): Promise<string> {
    const email = normalizeEmail(rawEmail);
    const errors: Record<string, string[]> = {};
    if (!this.isValidEmail(email)) errors.email = ['Enter a valid email address.'];
    if (!(GUEST_PURPOSES as readonly unknown[]).includes(purpose)) {
      errors.purpose = ['Choose ticket, chat or lookup.'];
    }
    if (Object.keys(errors).length) {
      throw new UnprocessableEntityException({ message: Object.values(errors)[0][0], errors });
    }

    const perClient = clamp(this.config.challengesPerClientPerHour, 3, 1, 1000);
    const perMailbox = Math.max(
      perClient,
      clamp(this.config.challengesPerMailboxPerHour, 10, 1, 1000),
    );
    const storage = this.options.guestRateLimit?.storage ?? this.throttler;
    const mailboxKey = `escalated:guest-email:${this.digest(email)}`;
    const clientKey = `${mailboxKey}:client:${this.digest(clientIp || '')}`;
    for (const [key, limit] of [
      [clientKey, perClient],
      [mailboxKey, perMailbox],
    ] as const) {
      const hit = await storage.increment(key, HOUR_MS, limit, HOUR_MS, 'escalated-guest-code');
      if (hit.isBlocked) {
        throw new HttpException(
          {
            message: 'Please wait before requesting another code.',
            retryAfter: Math.max(1, hit.timeToBlockExpire),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Codes are short-lived; old rows are swept as new ones are made.
    await this.purgeExpired();
    const id = randomUUID();
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    await this.verifications.save({
      id,
      emailDigest: this.digest(email),
      purpose: purpose as string,
      codeHash: this.digest(`${id}:${code}`),
      attempts: 0,
      expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
      usedAt: null,
    });

    try {
      await this.deliver(email, code, purpose as GuestPurpose);
    } catch (error) {
      await this.verifications.delete({ id });
      throw error;
    }
    return id;
  }

  private async deliver(email: string, code: string, purpose: GuestPurpose): Promise<void> {
    if (this.config.sendCode) return void (await this.config.sendCode(email, code, purpose));
    if (!this.email?.canSend()) {
      this.logger.warn('A guest verification code was requested but no mail transport is set.');
      return;
    }
    await this.email.sendGuestCode(email, code);
  }

  /**
   * Spend a code on `callback`. Every guess counts, right or wrong, and a
   * wrong guess is never undone. The code is claimed with a conditional
   * update, so two requests cannot both spend it; if `callback` throws, the
   * claim is released so the guest can retry with the same code.
   */
  async consume<T>(
    verificationId: unknown,
    code: unknown,
    email: unknown,
    purpose: GuestPurpose,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (typeof verificationId !== 'string' || !UUID.test(verificationId)) {
      throw new InvalidGuestCode();
    }
    const verification = await this.verifications.findOne({ where: { id: verificationId } });
    if (
      !verification ||
      verification.usedAt ||
      new Date(verification.expiresAt).getTime() <= Date.now() ||
      verification.attempts >= MAX_ATTEMPTS
    ) {
      throw new InvalidGuestCode();
    }

    const counted = await this.verifications.update(
      { id: verification.id, attempts: verification.attempts, usedAt: IsNull() },
      { attempts: verification.attempts + 1 },
    );
    if (counted.affected !== 1) throw new InvalidGuestCode();

    const matches =
      same(verification.codeHash, this.digest(`${verification.id}:${String(code ?? '')}`)) &&
      same(verification.emailDigest, this.emailDigest(email)) &&
      verification.purpose === purpose;
    if (!matches) throw new InvalidGuestCode();

    const claimed = await this.verifications.update(
      { id: verification.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (claimed.affected !== 1) throw new InvalidGuestCode();

    try {
      return await callback();
    } catch (error) {
      await this.verifications.update({ id: verification.id }, { usedAt: null });
      throw error;
    }
  }

  /** Deletes codes that expired more than a day ago. Returns how many. */
  async purgeExpired(): Promise<number> {
    const result = await this.verifications.delete({
      expiresAt: LessThan(new Date(Date.now() - 24 * HOUR_MS)),
    });
    return result.affected ?? 0;
  }

  // -------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------

  /** The ticket's guest email: its contact's address. */
  async guestEmail(ticket: Ticket): Promise<string | null> {
    if (ticket.contactId == null) return null;
    const contact = await this.contacts.findOne({ where: { id: ticket.contactId } });
    return contact?.email ?? null;
  }

  /** Records that the ticket's guest email was proven. Does not save. */
  markVerified(ticket: Ticket, email: unknown): void {
    ticket.guestVerifiedEmail = this.emailDigest(email);
    ticket.guestEmailVerifiedAt = new Date();
  }

  /** The proven email is still the ticket's guest email. */
  async verified(ticket: Ticket): Promise<boolean> {
    if (!ticket.guestEmailVerifiedAt || !ticket.guestVerifiedEmail) return false;
    const email = await this.guestEmail(ticket);
    return !!email && same(ticket.guestVerifiedEmail, this.emailDigest(email));
  }

  /**
   * A new grant for a ticket whose guest email has been proven. Saves the
   * ticket, revoking earlier grants and the permanent legacy token. A trusted
   * entry point: never call it without consuming mailbox proof.
   */
  async issue(ticket: Ticket): Promise<GuestGrant> {
    if (!(await this.verified(ticket))) {
      throw new Error('Guest access requires a verified ticket email.');
    }
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Math.floor((Date.now() + this.ttlMinutes() * 60_000) / 1000) * 1000);
    await this.tickets.update(ticket.id, {
      guestVerifiedEmail: ticket.guestVerifiedEmail,
      guestEmailVerifiedAt: ticket.guestEmailVerifiedAt,
      guestAccessHash: sha256(nonce),
      guestAccessExpiresAt: expiresAt,
      guestAccessToken: null as any,
    });
    Object.assign(ticket, {
      guestAccessHash: sha256(nonce),
      guestAccessExpiresAt: expiresAt,
      guestAccessToken: null,
    });
    const claims = {
      v: 1,
      t: ticket.id,
      n: nonce,
      x: Math.floor(expiresAt.getTime() / 1000),
      e: ticket.guestVerifiedEmail,
    };
    return { token: this.encrypt(JSON.stringify(claims)), expiresAt };
  }

  /** The ticket an active grant names, or null. Never accepts a legacy token. */
  async resolve(token: unknown): Promise<Ticket | null> {
    if (typeof token !== 'string' || token.length < 40 || token.length > 2048) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
    let claims: any;
    try {
      claims = JSON.parse(this.decrypt(token));
    } catch {
      return null;
    }
    if (
      !claims ||
      claims.v !== 1 ||
      !Number.isInteger(claims.t) ||
      typeof claims.n !== 'string' ||
      !Number.isInteger(claims.x) ||
      claims.x <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    const ticket = await this.tickets.findOne({ where: { id: claims.t } });
    if (!ticket || !ticket.guestAccessHash || !ticket.guestAccessExpiresAt) return null;
    const expires = new Date(ticket.guestAccessExpiresAt).getTime();
    if (expires <= Date.now() || Math.floor(expires / 1000) !== claims.x) return null;
    if (!same(ticket.guestAccessHash, sha256(claims.n))) return null;
    if (!same(String(claims.e ?? ''), ticket.guestVerifiedEmail ?? '')) return null;
    if (!(await this.verified(ticket))) return null;
    return ticket;
  }

  /**
   * The ticket a guest credential opens: an active grant, or, only with
   * `guestAccess.legacyTokens`, a permanent token issued before verification.
   */
  async ticketForToken(token: unknown): Promise<Ticket | null> {
    const ticket = await this.resolve(token);
    if (ticket) return ticket;
    if (!this.legacyTokensEnabled() || typeof token !== 'string' || !LEGACY_TOKEN.test(token)) {
      return null;
    }
    return this.tickets.findOne({ where: { guestAccessToken: token } });
  }

  /** Revokes every grant and the legacy token. */
  async revoke(ticket: Ticket): Promise<void> {
    await this.tickets.update(ticket.id, {
      guestAccessHash: null,
      guestAccessExpiresAt: null,
      guestAccessToken: null as any,
    });
    Object.assign(ticket, {
      guestAccessHash: null,
      guestAccessExpiresAt: null,
      guestAccessToken: null,
    });
  }

  private key(): Buffer {
    return createHash('sha256').update(`escalated-guest-grant:${this.secret()}`).digest();
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  private decrypt(token: string): string {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) throw new Error('short');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

/** Headers for guest answers: they carry access credentials. */
export function privateGuestResponse(res: { header?: (name: string, value: string) => unknown }) {
  res?.header?.('Cache-Control', 'no-store, private');
  res?.header?.('Referrer-Policy', 'no-referrer');
}
