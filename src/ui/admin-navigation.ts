import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { accessFeatureEnabled } from '../access/access-features';
import { AccessControlService } from '../access/access-control.service';
import { mappedPermissions } from '../access/route-permissions';
import { ESCALATED_ROUTE_GROUP } from '../guards/escalated-route.guard';
import { PLUGIN_REGISTRY } from '../plugins/plugin-definition';
import type { PluginRegistry } from '../plugins/plugin-registry.service';
import { resolveEmbed } from './embed';
import { canonicalRoute, escalatedRoutes, routeUrl } from './routes';

/** One entry of Escalated's admin menu (`escalated.navigation`). */
export interface EscalatedNavigationItem {
  /** Stable id; plugin items are `plugin:<slug>:<n>`. */
  key: string;
  label: string;
  /** Route name, or null for plugin items (and the newsletter admin, which has no named route here). */
  route: string | null;
  /** Absolute path. */
  url: string;
  icon: string | null;
  position: number;
  /** The current request's path is `url` or below it. */
  active: boolean;
  badge: unknown;
  plugin: string | null;
  children: Omit<EscalatedNavigationItem, 'children'>[];
}

/**
 * Core items: key (also the icon key), label, route name, position. Labels
 * and positions are the standalone admin sidebar's in the shared frontend.
 */
export const ADMIN_NAVIGATION_ITEMS: readonly (readonly [string, string, string, number])[] = [
  ['reports', 'Reports', 'escalated.admin.reports', 10],
  ['tickets', 'Tickets', 'escalated.admin.tickets.index', 20],
  ['departments', 'Departments', 'escalated.admin.departments.index', 30],
  ['sla-policies', 'SLA Policies', 'escalated.admin.sla-policies.index', 40],
  ['knowledge-base', 'Knowledge Base', 'escalated.admin.kb-articles.index', 45],
  ['escalation-rules', 'Escalation Rules', 'escalated.admin.escalation-rules.index', 50],
  ['workflows', 'Workflows', 'escalated.admin.workflows.index', 53],
  ['automations', 'Automations', 'escalated.admin.automations.index', 53.5],
  ['webhooks', 'Webhooks', 'escalated.admin.webhooks.index', 54],
  ['tags', 'Tags', 'escalated.admin.tags.index', 60],
  ['custom-fields', 'Custom Fields', 'escalated.admin.custom-fields.index', 62],
  ['statuses', 'Statuses', 'escalated.admin.statuses.index', 64],
  ['canned-responses', 'Canned Responses', 'escalated.admin.canned-responses.index', 70],
  ['macros', 'Macros', 'escalated.admin.macros.index', 80],
  ['newsletters', 'Newsletters', 'escalated.admin.newsletters.index', 81],
  ['skills', 'Skills', 'escalated.admin.skills.index', 82],
  ['users', 'Users', 'escalated.admin.users.index', 83],
  ['roles', 'Roles', 'escalated.admin.roles.index', 84],
  ['capacity', 'Capacity', 'escalated.admin.capacity.index', 85],
  ['business-hours', 'Business Hours', 'escalated.admin.business-hours.index', 86],
  ['audit-log', 'Audit Log', 'escalated.admin.audit-log', 88],
  ['api-tokens', 'API Tokens', 'escalated.admin.api-tokens.index', 90],
  ['custom-objects', 'Custom Objects', 'escalated.admin.custom-objects.index', 92],
  ['plugins', 'Plugins', 'escalated.admin.plugins.index', 95],
  ['import', 'Import', 'escalated.admin.import.index', 97],
  ['settings', 'Settings', 'escalated.admin.settings', 100],
];

/** The newsletter admin (`enableNewsletters`) has no named route in this port. */
const NEWSLETTERS_URL = '/admin/newsletters';

export interface AdminNavigationInput {
  options: EscalatedModuleOptions;
  moduleRef?: ModuleRef;
  /** The signed-in user (`{ id }`), or null. */
  user: { id: unknown } | null | undefined;
  /** The current request: the path marks the active item; plugin capabilities read it. */
  request?: any;
  /**
   * Whether the user passes Escalated's admin gate, when the caller knows.
   * Otherwise: true on a request `adminGuard` admitted to an admin route,
   * else `ticketAccess.resolveUser()`'s `isAdmin`, else false.
   */
  isAdmin?: boolean;
}

function present(id: unknown): boolean {
  return (typeof id === 'number' || typeof id === 'string') && id !== '' && String(id) !== '0';
}

function pathOf(request: any): string {
  return String(request?.originalUrl ?? request?.url ?? '').split('?')[0];
}

function item(
  key: string,
  label: string,
  route: string | null,
  url: string,
  icon: string | null,
  position: number,
  path: string,
): EscalatedNavigationItem {
  const target = url.split('?')[0].replace(/\/+$/, '') || '/';
  return {
    key,
    label,
    route,
    url,
    icon,
    position,
    active: path === target || path.startsWith(`${target}/`),
    badge: null,
    plugin: null,
    children: [],
  };
}

function get<T>(moduleRef: ModuleRef | undefined, token: any): T | null {
  try {
    return moduleRef ? moduleRef.get<T>(token, { strict: false }) : null;
  } catch {
    return null;
  }
}

async function passesAdminGate(input: AdminNavigationInput): Promise<boolean> {
  if (input.isAdmin !== undefined) return input.isAdmin;
  if (input.request?.[ESCALATED_ROUTE_GROUP] === 'admin') return true;
  const resolveUser = input.options.ticketAccess?.resolveUser;
  if (!resolveUser) return false;
  try {
    return !!(await resolveUser(input.user!.id as any))?.isAdmin;
  } catch {
    return false;
  }
}

/**
 * Escalated's admin menu for a user, as `NavigationItem[]` (ADR
 * 2026-11-05-embeddable-admin): shared as `escalated.navigation` while the
 * admin is embedded, and what a server-rendered host lists in its sidebar.
 *
 * Filtered so a host sidebar never links to a screen that would refuse the
 * user: empty for anyone who fails Escalated's admin gate (unless the host
 * replaced it, then any signed-in user), screens whose feature is off are
 * left out (Roles while roles & permissions is off, Newsletters while they
 * are off), and while roles & permissions is on every item needs the
 * permissions its route requires. Active plugins' admin menu items are
 * merged in, and everything is sorted by `position`. URLs follow wherever
 * the admin is mounted, embedded or not.
 */
export async function adminNavigation(
  input: AdminNavigationInput,
): Promise<EscalatedNavigationItem[]> {
  const { options, moduleRef, user, request } = input;
  if (!user || !present(user.id)) return [];
  const embed = resolveEmbed(options);
  if (!embed?.replaceAdminGate && !(await passesAdminGate(input))) return [];

  const rolesPermissions = accessFeatureEnabled(options, 'roles_permissions');
  let granted: string[] | null = null;
  if (rolesPermissions) {
    const access = get<AccessControlService>(moduleRef, AccessControlService);
    granted = access ? await access.sharedPermissions(user.id as any, true) : [];
  }
  const allowed = (path: string) => {
    if (granted === null) return true;
    const required = mappedPermissions('GET', path);
    return required !== null && required.every((slug) => granted!.includes(slug));
  };

  const path = pathOf(request);
  const table = escalatedRoutes();
  const items: EscalatedNavigationItem[] = [];

  for (const [key, label, route, position] of ADMIN_NAVIGATION_ITEMS) {
    if (key === 'roles' && !rolesPermissions) continue;
    if (key === 'newsletters') {
      if (options.enableNewsletters !== true || !allowed(NEWSLETTERS_URL)) continue;
      items.push(item(key, label, null, NEWSLETTERS_URL, key, position, path));
      continue;
    }
    const declared = canonicalRoute(route);
    if (!table[route] || !declared) continue;
    if (!allowed('/' + declared.uri)) continue;
    items.push(item(key, label, route, routeUrl(route), key, position, path));
  }

  const registry = get<PluginRegistry>(moduleRef, PLUGIN_REGISTRY);
  if (registry?.all().length) {
    let extensions: Record<string, unknown> = {};
    try {
      extensions = await registry.uiExtensions(request ?? {}, true);
    } catch {
      extensions = {};
    }
    const menu = ((extensions.menuItems as Record<string, any>[]) ?? []).filter(
      (entry) => (entry.section ?? 'admin') === 'admin',
    );
    menu.forEach((entry, index) => {
      if (typeof entry.route !== 'string' || entry.route === '') return;
      const plugin = typeof entry.plugin === 'string' ? entry.plugin : null;
      const position = Number(entry.position ?? 100);
      items.push({
        ...item(
          `plugin:${plugin ?? 'native'}:${index}`,
          String(entry.label ?? ''),
          null,
          entry.route,
          typeof entry.icon === 'string' ? entry.icon : null,
          Number.isFinite(position) ? position : 100,
          path,
        ),
        badge: entry.badge ?? null,
        plugin,
      });
    });
  }

  // Stable: equal positions keep their order (core items first).
  return items
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.position - b.entry.position || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * `adminNavigation()` as an injectable, for a host's own pages and
 * server-rendered layouts:
 *
 *     constructor(private readonly nav: EscalatedAdminNavigation) {}
 *     const items = await this.nav.adminNavigation(req.user, req);
 */
@Injectable()
export class EscalatedAdminNavigation {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  adminNavigation(
    user: { id: unknown } | null | undefined,
    request?: any,
    extra: { isAdmin?: boolean } = {},
  ): Promise<EscalatedNavigationItem[]> {
    return adminNavigation({
      options: this.options ?? {},
      moduleRef: this.moduleRef,
      user,
      request,
      isAdmin: extra.isAdmin,
    });
  }
}
