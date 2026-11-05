import type { CanActivate, Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { InertiaPageObject } from './ui-options';
import { routeNameFor } from './routes';

/**
 * Embedding Escalated's admin in the host's own admin panel (optional; ADR
 * 2026-11-05-embeddable-admin). Off by default: while `ui.embed.enabled` is
 * not true nothing here has any effect, and the standalone admin stays at
 * `/escalated/admin` with its own chrome.
 */

export const EMBED_MODES = ['layout', 'iframe'] as const;
export type EscalatedEmbedMode = (typeof EMBED_MODES)[number];

/** A host guard: a `CanActivate` class (resolved with DI) or instance. */
export type EscalatedEmbedGuard = Type<CanActivate> | CanActivate;

/** A host middleware: a `NestMiddleware` class or an Express-style function. */
export type EscalatedEmbedMiddleware = Type<any> | ((req: any, res: any, next: () => void) => void);

export interface EscalatedEmbedOptions {
  /** Master switch. Default `false` (env `ESCALATED_EMBED`). Needs `ui.enabled`. */
  enabled?: boolean;
  /**
   * `'layout'` (a Vue + Inertia host layout, or a server-rendered root view)
   * or `'iframe'` (framed by an allow-listed origin). Default `'layout'`
   * (env `ESCALATED_EMBED_MODE`).
   */
  mode?: EscalatedEmbedMode;
  /**
   * URL prefix the admin routes move under, instead of `escalated/admin`.
   * Default `'admin/support'` (env `ESCALATED_EMBED_PREFIX`).
   */
  prefix?: string;
  /**
   * Host middleware for the embedded admin routes only (session, sign-in,
   * your admin check...), run before Escalated's guards. Default: none.
   */
  middleware?: EscalatedEmbedMiddleware[] | null;
  /**
   * Host guards for the embedded admin routes only, run before Escalated's
   * admin gate (`adminGuard`). Default: none, so `adminGuard` alone decides,
   * as on the standalone admin.
   */
  guards?: EscalatedEmbedGuard[] | null;
  /**
   * `true` removes Escalated's admin gate (`adminGuard`) from the embedded
   * routes, so your `guards` / `middleware` alone decide who reaches the
   * admin. Two-factor and route permissions still apply. Refused at boot
   * without any `guards` or `middleware`. Default `false`.
   */
  replaceAdminGate?: boolean;
  /** Name of the host layout the frontend's `layouts` option should wrap admin pages in. */
  layout?: string | null;
  /**
   * The HTML document for a first visit to an embedded admin page (a
   * server-rendered host's admin template: its chrome plus the Inertia mount
   * point). Used on embedded admin responses only; `null` keeps `ui.rootView`.
   */
  rootView?: ((page: InertiaPageObject, request: any) => string | Promise<string>) | null;
  /**
   * iframe mode: exact origins allowed to frame the admin
   * (`https://admin.example.com`). Wildcards and `*` are dropped. Default `[]`
   * (env `ESCALATED_EMBED_FRAME_ANCESTORS`, comma-separated).
   */
  frameAncestors?: string[] | string;
}

/** The embed configuration in effect, with defaults applied. */
export interface ResolvedEmbed {
  mode: EscalatedEmbedMode;
  /** Without leading or trailing slashes. */
  prefix: string;
  middleware: EscalatedEmbedMiddleware[];
  guards: EscalatedEmbedGuard[];
  replaceAdminGate: boolean;
  layout: string | null;
  rootView: EscalatedEmbedOptions['rootView'];
  frameAncestors: string[];
}

/**
 * Metadata on an embedded admin controller: the path its base class declares
 * (`escalated/admin/...`), which route permissions and the ticket-access
 * checks keep matching against wherever the admin is mounted.
 */
export const ESCALATED_CANONICAL_PATH = 'escalated:canonical-path';

/** The path a controller's routes are declared under, before any embedding. */
export function canonicalControllerPath(controller: unknown): string {
  if (typeof controller !== 'function') return '';
  return (
    Reflect.getMetadata(ESCALATED_CANONICAL_PATH, controller) ??
    Reflect.getMetadata(PATH_METADATA, controller) ??
    ''
  );
}

/** Request property marking a request served by an embedded admin route. */
export const ESCALATED_EMBEDDED = 'escalatedEmbedded';

/** Request property marking a request served by an embedded admin route in iframe mode. */
export const ESCALATED_EMBED_FRAME = 'escalatedEmbedFrame';

export const DEFAULT_EMBED_PREFIX = 'admin/support';

type Env = Record<string, string | undefined>;

function envFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

/**
 * An exact `scheme://host[:port]` origin, or null for anything else: wildcards,
 * `*`, paths, queries, credentials and non-http(s) schemes are dropped.
 */
export function embedOrigin(value: string): string | null {
  const text = value.trim();
  if (!text || text.includes('*')) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

/** The allow-list, deduplicated, without anything that is not an exact origin. */
export function embedFrameAncestors(configured: string[] | string | undefined | null): string[] {
  const list = typeof configured === 'string' ? configured.split(',') : (configured ?? []);
  const origins: string[] = [];
  for (const entry of list) {
    const origin = typeof entry === 'string' ? embedOrigin(entry) : null;
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/**
 * Checks and normalises an embed configuration, as `embedAdmin()` and
 * `EscalatedModule.forRoot()` do. Throws on an unknown mode, and on
 * `replaceAdminGate` without any host guard or middleware (that would leave
 * the admin with no check at all).
 */
function normalise(embed: EscalatedEmbedOptions, env: Env): ResolvedEmbed {
  const mode = (embed.mode ?? (env.ESCALATED_EMBED_MODE || 'layout')) as EscalatedEmbedMode;
  if (!EMBED_MODES.includes(mode)) {
    throw new Error(`Escalated ui.embed.mode must be 'layout' or 'iframe', got '${String(mode)}'.`);
  }
  const prefix = String(embed.prefix ?? (env.ESCALATED_EMBED_PREFIX || DEFAULT_EMBED_PREFIX))
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const guards = [...(embed.guards ?? [])];
  const middleware = [...(embed.middleware ?? [])];
  const replaceAdminGate = embed.replaceAdminGate === true;
  if (replaceAdminGate && !guards.length && !middleware.length) {
    throw new Error(
      'Escalated ui.embed.replaceAdminGate needs your own guards or middleware: without them nothing would check who reaches the admin.',
    );
  }
  return {
    mode,
    prefix: prefix || DEFAULT_EMBED_PREFIX,
    middleware,
    guards,
    replaceAdminGate,
    layout: typeof embed.layout === 'string' && embed.layout !== '' ? embed.layout : null,
    rootView: typeof embed.rootView === 'function' ? embed.rootView : null,
    frameAncestors: embedFrameAncestors(
      embed.frameAncestors ?? env.ESCALATED_EMBED_FRAME_ANCESTORS ?? [],
    ),
  };
}

const resolved = new WeakMap<object, ResolvedEmbed | null>();

/**
 * The embed configuration in effect for these module options, or null while
 * embedding is off (the default): `ui.embed.enabled` (or `ESCALATED_EMBED`)
 * is not true, or the screens (`ui.enabled`) are off.
 */
export function resolveEmbed(
  options: { ui?: { enabled?: boolean; embed?: EscalatedEmbedOptions } } | null | undefined,
  env: Env = process.env,
): ResolvedEmbed | null {
  if (!options) return null;
  if (resolved.has(options) && env === process.env) return resolved.get(options) ?? null;
  const embed = options.ui?.embed ?? {};
  const enabled = options.ui?.enabled === true && (embed.enabled ?? envFlag(env.ESCALATED_EMBED));
  const result = enabled === true ? normalise(embed, env) : null;
  if (env === process.env) resolved.set(options, result);
  return result;
}

/**
 * Turns embedding on, with the same settings as `ui.embed`:
 *
 *     EscalatedModule.forRoot({
 *       ui: {
 *         enabled: true,
 *         embed: embedAdmin({
 *           prefix: 'admin/support',
 *           guards: [AdminOnlyGuard],
 *           layout: 'Layouts/AdminLayout',
 *         }),
 *       },
 *     });
 *
 * Throws on an unknown `mode`, and on `replaceAdminGate` without guards or
 * middleware.
 */
export function embedAdmin(
  options: Omit<EscalatedEmbedOptions, 'enabled'> = {},
): EscalatedEmbedOptions {
  const embed: EscalatedEmbedOptions = {
    mode: 'layout',
    prefix: DEFAULT_EMBED_PREFIX,
    guards: null,
    middleware: null,
    replaceAdminGate: false,
    layout: null,
    rootView: null,
    frameAncestors: [],
    ...options,
    enabled: true,
  };
  normalise(embed, {});
  return embed;
}

/** Whether this request was served by an embedded admin route. */
export function isEmbeddedRequest(request: any): boolean {
  return request?.[ESCALATED_EMBEDDED] === true;
}

/** The `Content-Security-Policy` an embedded iframe response carries. */
export function frameAncestorsDirective(embed: Pick<ResolvedEmbed, 'frameAncestors'>): string {
  return ["frame-ancestors 'self'", ...embed.frameAncestors].join(' ');
}

function requestPath(request: any): string {
  return String(request?.originalUrl ?? request?.url ?? '/').split('?')[0];
}

/** The `escalated.embed` shared prop (shared only while embedding is on). */
export function embedProp(embed: ResolvedEmbed, request: any): Record<string, unknown> {
  const embedded = isEmbeddedRequest(request);
  return {
    enabled: embedded,
    mode: embed.mode,
    layout: embed.layout,
    route: embedded ? routeNameFor(String(request?.method ?? 'GET'), requestPath(request)) : null,
    base_url: '/' + embed.prefix,
    allowed_origins: embed.mode === 'iframe' ? embed.frameAncestors : [],
  };
}

/**
 * Marks a request admitted to an embedded admin route. In iframe mode, once
 * the whole response is built (when its headers are written, so after any
 * host middleware, interceptor or helmet), allows the configured origins to
 * frame it and drops `X-Frame-Options` from it. A host CSP already on the
 * response is kept and `frame-ancestors` is added as a second policy. No
 * other response is touched; layout mode adds no headers.
 */
export function markEmbedded(request: any, response: any, embed: ResolvedEmbed): void {
  if (!request) return;
  request[ESCALATED_EMBEDDED] = true;
  if (embed.mode !== 'iframe') return;
  request[ESCALATED_EMBED_FRAME] = true;
  if (!response || typeof response.writeHead !== 'function') return;
  if (response.escalatedEmbedHeaders) return;
  response.escalatedEmbedHeaders = true;

  const directive = frameAncestorsDirective(embed);
  const writeHead = response.writeHead;
  response.writeHead = function (this: any, ...args: any[]) {
    // Headers passed straight to writeHead() count as well.
    for (const arg of args) {
      if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
        for (const key of Object.keys(arg)) {
          if (key.toLowerCase() === 'x-frame-options') delete arg[key];
        }
      }
    }
    if (!response.headersSent) {
      response.removeHeader('X-Frame-Options');
      const existing = response.getHeader('Content-Security-Policy');
      const policies = existing === undefined ? [] : ([] as unknown[]).concat(existing).map(String);
      response.setHeader('Content-Security-Policy', [...policies, directive]);
    }
    return writeHead.apply(this, args);
  };
}

/**
 * `SameSite` for the cookies the screens set themselves (flash data, the
 * import wizard): `None` on an embedded iframe response over HTTPS, so a
 * frame on another site sends them back; `Lax`, as always, otherwise.
 */
export function screenCookieSameSite(request: any, secure: boolean): 'None' | 'Lax' {
  return secure && request?.[ESCALATED_EMBED_FRAME] === true ? 'None' : 'Lax';
}
