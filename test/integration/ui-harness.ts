import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import manifest from '../fixtures/escalated-pages.json';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { bootEscalatedModule, type BootOptions } from './boot-escalated-module';

/**
 * Boots the real module with the screens on, over HTTP and SQLite, with host
 * guards that read the role and user from test headers, and helpers that make
 * requests the way a browser and the Inertia client do.
 */

export const ADMIN = 1;
export const AGENT = 21;
export const CUSTOMER = 300;

export const guardFor = (role: string): CanActivate => ({
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (
      !String(req.headers['x-role'] ?? '')
        .split(',')
        .includes(role)
    )
      return false;
    if (req.headers['x-user']) {
      req.user = { id: Number(req.headers['x-user']), name: `Person ${req.headers['x-user']}` };
    }
    return true;
  },
});

export const ROLES: Record<string, { role: string; user: number }> = {
  admin: { role: 'agent,admin,customer', user: ADMIN },
  agent: { role: 'agent', user: AGENT },
  customer: { role: 'customer', user: CUSTOMER },
};

export interface UiApp {
  app: INestApplication;
  source: DataSource;
  base: string;
}

export async function bootUi(
  escalated: EscalatedModuleOptions = {},
  host?: BootOptions['host'],
): Promise<UiApp> {
  const moduleRef = await bootEscalatedModule({
    host,
    escalated: {
      adminGuard: guardFor('admin'),
      agentGuard: guardFor('agent'),
      customerGuard: guardFor('customer'),
      ...escalated,
      ui: { enabled: true, ...(escalated.ui ?? {}) },
    },
  });
  const source = moduleRef.get(DataSource);
  await source.initialize();
  await source.synchronize();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, source, base };
}

export interface Visit {
  as?: keyof typeof ROLES;
  headers?: Record<string, string>;
  body?: unknown;
  method?: string;
}

function headersFor(base: string, visit: Visit): Record<string, string> {
  const who = ROLES[visit.as ?? 'agent'];
  return {
    'x-role': who.role,
    'x-user': String(who.user),
    ...(visit.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(visit.headers ?? {}),
  };
}

/** A request as the Inertia client makes it. */
export function inertiaFetch(base: string, path: string, visit: Visit = {}) {
  return fetch(`${base}${path}`, {
    method: visit.method ?? (visit.body !== undefined ? 'POST' : 'GET'),
    redirect: 'manual',
    headers: {
      'x-inertia': 'true',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'text/html, application/xhtml+xml',
      ...headersFor(base, visit),
    },
    body: visit.body !== undefined ? JSON.stringify(visit.body) : undefined,
  });
}

/** A request from an API client, which never asks for HTML. */
export function apiFetch(base: string, path: string, visit: Visit = {}) {
  return fetch(`${base}${path}`, {
    method: visit.method ?? (visit.body !== undefined ? 'POST' : 'GET'),
    redirect: 'manual',
    headers: { accept: 'application/json', ...headersFor(base, visit) },
    body: visit.body !== undefined ? JSON.stringify(visit.body) : undefined,
  });
}

/** An Inertia visit to a page, asserting it is one, and returning the page object. */
export async function page(base: string, path: string, visit: Visit = {}) {
  const res = await inertiaFetch(base, path, visit);
  if (res.status !== 200) {
    throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  }
  expect(res.headers.get('x-inertia')).toBe('true');
  return res.json();
}

const manifestProps = (manifest as any).props as Record<string, { props: string[] }>;

/**
 * The props the page's component reads (pages.json), each of which the
 * response must send: a missing one renders that part of the screen empty.
 */
export function expectManifestProps(pageObject: { component: string; props: object }) {
  const expected = manifestProps[pageObject.component]?.props;
  expect(expected).toBeDefined();
  const missing = expected.filter((key) => !(key in pageObject.props));
  expect(missing).toEqual([]);
}

/** The `Set-Cookie` value to send back, for flash data across a redirect. */
export function cookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  return header.split(';')[0];
}
