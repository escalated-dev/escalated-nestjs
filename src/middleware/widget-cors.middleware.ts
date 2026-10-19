import { Injectable, NestMiddleware, RequestMethod, Type } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { RouteInfo } from '@nestjs/common/interfaces';
import type { IncomingMessage, ServerResponse } from 'http';
import { WIDGET_EMBED_ORIGIN } from '../config/widget-embed';
import { WidgetOriginsService, requestCrossOrigin } from '../services/widget-origins.service';

export const WIDGET_CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
export const WIDGET_CORS_ALLOW_HEADERS = 'Accept, Authorization, Content-Type, X-Requested-With';
export const WIDGET_CORS_MAX_AGE = 600;

const SEEN = Symbol('escalated.widget.cors');

/** Add `Origin` to the response's Vary header, keeping whatever it already lists. */
function varyOnOrigin(res: ServerResponse): void {
  const current = res.getHeader('Vary');
  const values = (Array.isArray(current) ? current.join(',') : String(current ?? ''))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (!values.some((value) => value === '*' || value.toLowerCase() === 'origin')) {
    values.push('Origin');
  }
  res.setHeader('Vary', values.join(', '));
}

/**
 * CORS for the widget routes. Only origins on the widget allow list get CORS
 * headers; everything else passes through untouched.
 *
 * - A preflight (`OPTIONS` with `Access-Control-Request-Method`) is answered
 *   here with 204. Allowed origins get the grant; others get none.
 * - Any other request from an allowed origin gets `Access-Control-Allow-Origin`
 *   before the route runs, so every answer carries it, including the 400, 403,
 *   404 and 429 that guards and exception filters produce.
 * - Such a request is always a guest: the host's signed-in user is removed, and
 *   the request is marked so Escalated never resolves a user for it.
 *
 * Credentials are never allowed, so the browser sends no cookies with these
 * requests. Guest tokens travel in headers or the query string.
 *
 * Written against Node's request/response so it runs under both the Express
 * and Fastify adapters.
 */
@Injectable()
export class WidgetCorsMiddleware implements NestMiddleware {
  constructor(private readonly origins: WidgetOriginsService) {}

  async use(
    req: IncomingMessage & Record<PropertyKey, any>,
    res: ServerResponse,
    next: () => void,
  ) {
    // A request can match more than one registered widget path.
    if (req[SEEN]) return next();
    req[SEEN] = true;

    const origin = requestCrossOrigin(req);
    const allowed = origin !== null && (await this.origins.allows(origin));

    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      varyOnOrigin(res);
      if (allowed) {
        this.grant(res, origin);
        res.setHeader('Access-Control-Allow-Methods', WIDGET_CORS_ALLOW_METHODS);
        res.setHeader('Access-Control-Allow-Headers', WIDGET_CORS_ALLOW_HEADERS);
        res.setHeader('Access-Control-Max-Age', String(WIDGET_CORS_MAX_AGE));
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!allowed) return next();

    // A cross-site embed is always anonymous: never act as whoever is signed
    // in to the host app in the same browser.
    req[WIDGET_EMBED_ORIGIN] = origin;
    delete req.user;

    this.grant(res, origin);
    next();
  }

  private grant(res: ServerResponse, origin: string): void {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    varyOnOrigin(res);
  }
}

/**
 * One route per distinct path of the given controllers, for every method, so
 * the middleware also sees `OPTIONS` preflights for paths that only declare
 * GET or POST handlers. Built from the controllers' own route metadata, so it
 * needs no wildcard syntax (which differs between Nest 10 and 11) and follows
 * any route added later.
 */
export function routesOf(...controllers: Type<unknown>[]): RouteInfo[] {
  const paths = new Set<string>();
  const join = (...parts: string[]) =>
    parts
      .map((part) => part.replace(/^\/+|\/+$/g, ''))
      .filter((part) => part !== '')
      .join('/');

  for (const controller of controllers) {
    const bases: string[] = [].concat(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const prototype = controller.prototype;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const routes = Reflect.getMetadata(PATH_METADATA, handler);
      if (routes === undefined) continue;
      for (const base of bases) {
        for (const route of [].concat(routes)) paths.add(join(base, route));
      }
    }
  }

  return [...paths].map((path) => ({ path, method: RequestMethod.ALL }));
}
