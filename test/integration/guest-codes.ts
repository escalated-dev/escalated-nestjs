import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

/**
 * Captures the codes verified guest access emails, so tests can complete the
 * proof step the shared widget asks guests for.
 */
export class GuestOutbox {
  readonly sent: Array<{ email: string; code: string; purpose: string }> = [];

  /** `guestAccess` options that deliver codes here instead of by mail. */
  options(
    extra: EscalatedModuleOptions['guestAccess'] = {},
  ): EscalatedModuleOptions['guestAccess'] {
    return {
      secret: 'test-guest-access-secret',
      ...extra,
      sendCode: (email, code, purpose) => {
        this.sent.push({ email, code, purpose });
      },
    };
  }

  /** The last code sent to `email`. */
  codeFor(email: string): string {
    const found = [...this.sent].reverse().find((entry) => entry.email === email.toLowerCase());
    if (!found) throw new Error(`No code was sent to ${email}`);
    return found.code;
  }

  /**
   * Requests a code over HTTP at `base` (`.../escalated/widget` or
   * `.../escalated/guest`) and returns the proof fields to send with the
   * operation.
   */
  async proof(
    base: string,
    email: string,
    purpose: 'ticket' | 'chat' | 'lookup',
  ): Promise<{ verification_id: string; verification_code: string }> {
    const res = await fetch(`${base}/verification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, purpose }),
    });
    if (res.status !== 202) throw new Error(`verification answered ${res.status}`);
    const { verification_id } = await res.json();
    return { verification_id, verification_code: this.codeFor(email) };
  }
}

/**
 * A `GuestTicketsService` stand-in that skips the email proof, for specs about
 * something else (requester identity, rate limits) that stub the ticket
 * services. The proof itself is covered by verified-guest-access.spec.ts.
 */
export function guestProofSkipped() {
  return {
    withProof: jest.fn((_body: unknown, _purpose: string, run: () => unknown) => run()),
    grantFor: jest.fn(async () => ({
      guest_access_token: 'grant',
      expires_at: '2030-01-01T00:00:00.000Z',
    })),
    replyBody: (body: { body?: string }) => String(body?.body ?? ''),
    status: jest.fn(async (ticket: { referenceNumber?: string }) => ({
      reference: ticket.referenceNumber,
    })),
  };
}
