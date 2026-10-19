import { Inject, Injectable } from '@nestjs/common';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { SettingsService } from './settings.service';

export { WIDGET_EMBED_ORIGIN, embedOrigin } from '../config/widget-embed';

/** Settings key holding the admin-managed list (one origin per line or comma separated). */
export const WIDGET_ALLOWED_ORIGINS_SETTING = 'widget_allowed_origins';

/** Environment variable holding a comma-separated list, merged with the module option. */
export const WIDGET_ALLOWED_ORIGINS_ENV = 'ESCALATED_WIDGET_ALLOWED_ORIGINS';

/** `scheme://host[:port]`, lowercased, default ports dropped; null for anything else. */
export function normalizeOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  // A query or fragment marker with nothing after it is dropped by URL, not rejected.
  if (/[?#]/.test(value)) return null;

  // URL already lowercases scheme and host and drops default ports.
  return `${url.protocol}//${url.host}`;
}

/**
 * Normalise an admin-entered origin or `https://*.example.com` pattern, or
 * null when it is not a bare http(s) origin. A bare `*` is never accepted.
 */
export function normalizeOriginPattern(entry: string): string | null {
  const match = /^(https?):\/\/(\*\.)?([^/?#*@]+?)\/?$/i.exec(entry.trim());
  if (!match) return null;

  const origin = normalizeOrigin(`${match[1]}://${match[3]}`);
  if (origin === null) return null;
  return match[2] ? origin.replace('://', '://*.') : origin;
}

/** Split an admin-entered list on newlines, commas and spaces. */
export function splitOriginList(value: string | string[]): string[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.flatMap((entry) => String(entry).split(/[\s,]+/)).filter((entry) => entry !== '');
}

/** The entries of an admin-entered list that are not bare origins. */
export function invalidOriginEntries(value: string | string[]): string[] {
  return splitOriginList(value).filter((entry) => normalizeOriginPattern(entry) === null);
}

function originMatches(pattern: string, origin: string): boolean {
  const wildcard = pattern.indexOf('://*.');
  if (wildcard === -1) return pattern === origin;

  const scheme = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + '://*.'.length);
  if (!origin.startsWith(`${scheme}://`)) return false;
  const host = origin.slice(scheme.length + 3);
  return host.endsWith(`.${suffix}`) && host.length > suffix.length + 1;
}

function patternsFrom(entries: string[]): string[] {
  const patterns = entries
    .map((entry) => normalizeOriginPattern(entry))
    .filter((pattern): pattern is string => pattern !== null);
  return [...new Set(patterns)];
}

/**
 * The request's Origin when it names another site, or null for same-origin
 * requests, requests without an Origin header and the opaque `null` origin.
 *
 * The request's own origin is its protocol (`req.protocol`, which honours the
 * HTTP adapter's `trust proxy`) and its Host header.
 */
export function requestCrossOrigin(request: any): string | null {
  const header = request.headers?.origin;
  if (typeof header !== 'string' || header === '' || header === 'null') return null;

  const origin = normalizeOrigin(header);
  if (origin === null) return null;

  const protocol =
    typeof request.protocol === 'string'
      ? request.protocol
      : request.socket?.encrypted
        ? 'https'
        : 'http';
  const host = request.headers?.host;
  const own = typeof host === 'string' ? normalizeOrigin(`${protocol}://${host}`) : null;
  return origin === own ? null : origin;
}

/**
 * Decides which other sites may embed the widget. The allow list is the
 * `widgetOrigins` module option, plus `ESCALATED_WIDGET_ALLOWED_ORIGINS`
 * (comma separated), plus the `widget_allowed_origins` admin setting.
 * Entries that are not bare origins are ignored.
 */
@Injectable()
export class WidgetOriginsService {
  constructor(
    @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions,
    private readonly settings: SettingsService,
  ) {}

  /** Patterns from the module option and the environment (no settings read). */
  configuredPatterns(): string[] {
    return patternsFrom([
      ...(this.options.widgetOrigins ?? []),
      ...splitOriginList(process.env[WIDGET_ALLOWED_ORIGINS_ENV] ?? ''),
    ]);
  }

  /** Every allowed pattern, including the admin setting. */
  async patterns(): Promise<string[]> {
    const setting = await this.settings.get(WIDGET_ALLOWED_ORIGINS_SETTING, '');
    return patternsFrom([...this.configuredPatterns(), ...splitOriginList(setting ?? '')]);
  }

  async allows(origin: string): Promise<boolean> {
    const normalized = normalizeOrigin(origin);
    if (normalized === null) return false;

    const matches = (patterns: string[]) => patterns.some((p) => originMatches(p, normalized));
    return matches(this.configuredPatterns()) || matches(await this.patterns());
  }
}
