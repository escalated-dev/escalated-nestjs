import { INestApplication, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { escalatedRoutes } from '../../src/ui/routes';
import { bootEscalatedModule, type BootOptions } from './boot-escalated-module';

/** One registered route: where it answers, and what guards and intercepts it. */
export interface RouteEntry {
  controller: string;
  method: string;
  path: string;
  guards: string[];
  interceptors: string[];
}

export interface RouteTable {
  routes: RouteEntry[];
  /** The named routes the screens build URLs from (the `ziggy` prop). */
  named: Record<string, { uri: string; methods: string[] }>;
}

function nameOf(item: unknown): string {
  if (typeof item === 'function') return item.name;
  return (item as object)?.constructor?.name ?? String(item);
}

function join(...parts: string[]): string {
  const joined = ('/' + parts.join('/')).replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/**
 * The live route table of a booted app: every route of every controller the
 * app registered (found through Nest's discovery, so it is what Nest mounted),
 * with its class and handler guards and interceptors, and the named-route map.
 */
export function routeTableOf(app: INestApplication): RouteTable {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const routes: RouteEntry[] = [];

  for (const wrapper of discovery.getControllers()) {
    const type = wrapper.metatype as any;
    if (!type?.prototype) continue;
    const bases: string[] = [].concat(Reflect.getMetadata(PATH_METADATA, type) ?? '');
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, type) ?? []).map(nameOf);
    const classInterceptors = (Reflect.getMetadata(INTERCEPTORS_METADATA, type) ?? []).map(nameOf);

    for (const name of scanner.getAllMethodNames(type.prototype)) {
      const handler = type.prototype[name];
      const paths = Reflect.getMetadata(PATH_METADATA, handler);
      if (paths === undefined) continue;
      const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) ?? 0];
      const guards = [
        ...classGuards,
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).map(nameOf),
      ];
      const interceptors = [
        ...classInterceptors,
        ...(Reflect.getMetadata(INTERCEPTORS_METADATA, handler) ?? []).map(nameOf),
      ];
      for (const base of bases) {
        for (const path of [].concat(paths)) {
          routes.push({
            controller: type.name,
            method: verb,
            path: join(base, path),
            guards,
            interceptors,
          });
        }
      }
    }
  }

  routes.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method) ||
      a.controller.localeCompare(b.controller),
  );
  return { routes, named: JSON.parse(JSON.stringify(escalatedRoutes())) };
}

/** Boots the module (routes only, no database) and reads its route table. */
export async function bootRouteTable(
  escalated: EscalatedModuleOptions,
  host: BootOptions['host'] = {},
): Promise<{ app: INestApplication; table: RouteTable }> {
  const moduleRef = await bootEscalatedModule({
    escalated,
    host: { ...host, imports: [DiscoveryModule, ...(host.imports ?? [])] },
  });
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, table: routeTableOf(app) };
}
