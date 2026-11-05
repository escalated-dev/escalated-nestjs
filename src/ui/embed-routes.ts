import type { Type } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { EmbeddedAdminGuard, EscalatedAdminGuard } from '../guards/escalated-route.guard';
import { ESCALATED_CANONICAL_PATH, type ResolvedEmbed } from './embed';
import { normalizeRoutePath } from '../access/route-permissions';
import { STANDALONE_ADMIN_PREFIX } from './routes';

/** Whether a controller is one of the standalone admin's (`escalated/admin/...`). */
export function isAdminController(controller: Type<unknown>): boolean {
  const path = Reflect.getMetadata(PATH_METADATA, controller);
  if (typeof path !== 'string') return false;
  const normalized = normalizeRoutePath(path).slice(1);
  return (
    normalized === STANDALONE_ADMIN_PREFIX || normalized.startsWith(`${STANDALONE_ADMIN_PREFIX}/`)
  );
}

/**
 * The same controller mounted under the embed prefix: a subclass with the
 * same handlers, route paths below the prefix and parameters (all read from
 * the base class), whose `EscalatedAdminGuard` is replaced by
 * `EmbeddedAdminGuard`. Its other guards, interceptors and filters are kept.
 */
export function embedController<T>(controller: Type<T>, embed: ResolvedEmbed): Type<T> {
  const declared = normalizeRoutePath(Reflect.getMetadata(PATH_METADATA, controller)).slice(1);
  const moved = embed.prefix + declared.slice(STANDALONE_ADMIN_PREFIX.length);

  const Embedded = class extends (controller as Type<any>) {} as Type<T>;
  Object.defineProperty(Embedded, 'name', { value: `Embedded${controller.name}` });
  Reflect.defineMetadata(PATH_METADATA, moved, Embedded);
  Reflect.defineMetadata(ESCALATED_CANONICAL_PATH, declared, Embedded);

  const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
  Reflect.defineMetadata(
    GUARDS_METADATA,
    guards.map((guard) => (guard === EscalatedAdminGuard ? EmbeddedAdminGuard : guard)),
    Embedded,
  );
  return Embedded;
}

/**
 * The module's controllers with the admin ones moved under the embed prefix
 * (or unchanged while embedding is off), and the moved ones on their own.
 */
export function mountControllers(
  controllers: Type<any>[],
  embed: ResolvedEmbed | null,
): { controllers: Type<any>[]; embedded: Type<any>[] } {
  if (!embed) return { controllers, embedded: [] };
  const embedded: Type<any>[] = [];
  const mounted = controllers.map((controller) => {
    if (!isAdminController(controller)) return controller;
    const moved = embedController(controller, embed);
    embedded.push(moved);
    return moved;
  });
  return { controllers: mounted, embedded };
}
