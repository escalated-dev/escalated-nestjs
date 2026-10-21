/**
 * Flash data across the redirect after a form, in a short-lived cookie.
 *
 * Escalated owns no session, so the message and validation errors a form
 * redirect carries ride in `escalated_flash` and are cleared by the next page.
 * The cookie holds display text only and is never trusted for anything else.
 */
export const FLASH_COOKIE = 'escalated_flash';

export interface FlashState {
  flash: Record<string, unknown>;
  errors: Record<string, string>;
}

const EMPTY: FlashState = { flash: {}, errors: {} };

function cookies(request: any): Record<string, string> {
  const raw = String(request?.headers?.cookie ?? '');
  const found: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    found[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return found;
}

function stringsOnly(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

export function readFlash(request: any): FlashState | null {
  const value = cookies(request)[FLASH_COOKIE];
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return { flash: stringsOnly(parsed?.flash), errors: stringsOnly(parsed?.errors) };
  } catch {
    return { ...EMPTY };
  }
}

function attributes(request: any, maxAge: number): string {
  const secure = request?.secure || request?.protocol === 'https' ? '; Secure' : '';
  return `; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function flashCookie(request: any, state: FlashState): string {
  const value = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  return `${FLASH_COOKIE}=${value}${attributes(request, 60)}`;
}

export function clearFlashCookie(request: any): string {
  return `${FLASH_COOKIE}=${attributes(request, 0)}`;
}
