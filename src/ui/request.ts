import type { EscalatedModuleOptions } from '../config/escalated.config';
import { uiEnabled } from './ui-options';

function header(request: any, name: string): string {
  const value = request?.headers?.[name];
  return Array.isArray(value) ? value.join(',') : String(value ?? '');
}

/** An Inertia visit (`X-Inertia: true`), made by the Inertia client. */
export function isInertiaRequest(request: any): boolean {
  return header(request, 'x-inertia').toLowerCase() === 'true';
}

/** A browser navigation, which asks for HTML. API clients ask for JSON or anything. */
export function acceptsHtml(request: any): boolean {
  return header(request, 'accept').toLowerCase().includes('text/html');
}

/**
 * Whether a request on a route shared by the JSON API and the screens should
 * get the screen: only with `ui.enabled`, and only for an Inertia visit or a
 * browser navigation. API clients keep getting JSON either way.
 */
export function wantsPage(options: EscalatedModuleOptions | undefined, request: any): boolean {
  return uiEnabled(options) && (isInertiaRequest(request) || acceptsHtml(request));
}

/**
 * A request a page script made, not a cross-site form: browsers do not let
 * another site set these headers without a CORS preflight.
 */
export function isScriptedRequest(request: any): boolean {
  return isInertiaRequest(request) || header(request, 'x-requested-with') !== '';
}

/** The path and query of the request, as Inertia reports the page `url`. */
export function requestUrl(request: any): string {
  return String(request?.originalUrl ?? request?.url ?? '/');
}

/** The referring page's path, when it is on this host. */
export function sameOriginReferer(request: any): string | null {
  const referer = header(request, 'referer');
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.host !== header(request, 'host')) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
