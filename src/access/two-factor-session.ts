/**
 * Which user has passed the two-factor challenge in this session, kept in the
 * host's session (`req.session`, e.g. express-session). Stored as the user's
 * id, so a session that passed for one user does not count for another.
 *
 * A new login must start a new session (passport and most login handlers
 * regenerate it), or the host calls `forgetTwoFactorSession(req)` on login and
 * logout, as Laravel clears the mark on its Login and Logout events.
 */
const PASSED = 'escalatedTwoFactorPassed';
const INTENDED = 'escalatedIntendedUrl';
const FLASH = 'escalatedFlash';

export function hasSession(request: any): boolean {
  return !!request?.session && typeof request.session === 'object';
}

export function twoFactorPassed(request: any, userId: unknown): boolean {
  return hasSession(request) && request.session[PASSED] === String(userId);
}

export function markTwoFactorPassed(request: any, userId: unknown): void {
  if (hasSession(request)) request.session[PASSED] = String(userId);
}

export function forgetTwoFactorSession(request: any): void {
  if (hasSession(request)) delete request.session[PASSED];
}

/**
 * A new session id, keeping the session's data (the host's login with it), as
 * Laravel's `session()->regenerate()`. express-session's `regenerate` empties
 * the session, so its data is put back.
 */
export async function regenerateSession(request: any): Promise<void> {
  const session = request?.session;
  if (!hasSession(request) || typeof session.regenerate !== 'function') return;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(session)) {
    if (key !== 'cookie' && typeof value !== 'function') kept[key] = value;
  }
  await new Promise<void>((resolve, reject) =>
    session.regenerate((error: unknown) => (error ? reject(error) : resolve())),
  );
  Object.assign(request.session, kept);
}

export function rememberIntendedUrl(request: any, url: string): void {
  if (hasSession(request)) request.session[INTENDED] = url;
}

/** The page the user asked for before being sent to the challenge, once. */
export function takeIntendedUrl(request: any): string | null {
  if (!hasSession(request)) return null;
  const url = request.session[INTENDED];
  delete request.session[INTENDED];
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

/**
 * Flash data that must not ride in a cookie (recovery codes): kept in the
 * session for the next page, which takes it.
 */
export function flashToSession(request: any, data: Record<string, unknown>): void {
  if (hasSession(request)) request.session[FLASH] = { ...(request.session[FLASH] ?? {}), ...data };
}

export function takeSessionFlash(request: any): Record<string, unknown> {
  if (!hasSession(request) || !request.session[FLASH]) return {};
  const data = request.session[FLASH];
  delete request.session[FLASH];
  return data && typeof data === 'object' ? data : {};
}
