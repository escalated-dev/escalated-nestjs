/**
 * The permission each admin and agent route requires while roles &
 * permissions is enforced (ADR 2026-10-29-configurable-access-features).
 *
 * This is escalated-laravel's `src/Support/RoutePermissions.php`, keyed by
 * HTTP method and route path (as the controllers declare it, without a host
 * global prefix) instead of a route name. Entries are tried in order and the
 * first match wins, so exact paths come before wider patterns. In a pattern
 * `*` is one path segment, `**` is any number of them and `{a,b}` is either
 * word. A route that matches nothing is refused, and a test enumerates the
 * router so a new route cannot ship without an entry here.
 *
 * Every slug is one the roles migration seeds (escalated-laravel's
 * PermissionSeeder); none are invented here. An empty list means "staff, no
 * particular permission" and is kept for personal screens and for plugin
 * routes, which the plugin guards with its own capability.
 */

export type PermissionEntry = readonly [method: string, pattern: string, slugs: readonly string[]];

/** Statuses whose change needs `ticket.close` as well as `ticket.edit`. */
export const CLOSING_STATUSES = ['resolved', 'closed', 'reopened'];

/** Bulk actions and the permission each needs. */
export const BULK_ACTIONS: Record<string, string[]> = {
  status: ['ticket.edit'],
  priority: ['ticket.edit'],
  assign: ['ticket.assign'],
  tags: ['ticket.edit'],
  department: ['ticket.edit'],
  delete: ['ticket.delete'],
};

const A = '/escalated/admin';
const G = '/escalated/agent';
const STAFF = '/escalated/{admin,agent}';
const VIEW = ['ticket.view'];
const EDIT = ['ticket.edit'];

/**
 * index and reads => `{group}.view`; the create and edit forms and every
 * write => `{group}.manage`, as Laravel's `resource()` helper.
 */
function resource(path: string, group: string): PermissionEntry[] {
  const view = [`${group}.view`];
  const manage = [`${group}.manage`];
  return [
    ['GET', `${A}/${path}/create`, manage],
    ['GET', `${A}/${path}/new`, manage],
    ['GET', `${A}/${path}/*/edit`, manage],
    ['GET', `${A}/${path}`, view],
    ['GET', `${A}/${path}/**`, view],
    ['*', `${A}/${path}`, manage],
    ['*', `${A}/${path}/**`, manage],
  ];
}

export const ROUTE_PERMISSIONS: readonly PermissionEntry[] = [
  // ---- Personal ----------------------------------------------------------
  ['*', `${A}/2fa/**`, []],

  // ---- Tickets (admin and agent panels) ----------------------------------
  ['GET', G, VIEW],
  ['POST', `${STAFF}/tickets/bulk`, VIEW], // plus each action's, see requiredPermissions()
  ['GET', `${STAFF}/tickets`, VIEW],
  ['GET', `${STAFF}/tickets/*`, VIEW],
  ['GET', `${G}/tickets/*/{activities,replies,links,side-conversations}`, VIEW],
  ['POST', `${G}/tickets`, ['ticket.create']],
  ['POST', `${G}/tickets/*/split`, ['ticket.create']],
  ['PUT', `${G}/tickets/*`, EDIT],
  ['DELETE', `${G}/tickets/*`, ['ticket.delete']],
  ['POST', `${G}/tickets/*/merge/*`, ['ticket.merge']],
  ['POST', `${STAFF}/tickets/*/{status,priority,tags,department,snooze,unsnooze}`, EDIT],
  ['POST', `${G}/tickets/*/actions/*`, EDIT],
  ['POST', `${STAFF}/tickets/*/assign`, ['ticket.assign']],
  ['POST', `${STAFF}/tickets/*/follow`, VIEW],
  ['POST', `${STAFF}/tickets/*/macro`, ['macro.view', 'ticket.edit']],
  ['POST', `${STAFF}/tickets/*/reply`, ['reply.create']],
  ['POST', `${STAFF}/tickets/*/note`, ['reply.create_internal']],
  ['POST', `${G}/tickets/*/replies`, ['reply.create']], // an internal one needs reply.create_internal
  ['*', `${G}/tickets/*/links`, EDIT],
  ['*', `${G}/tickets/*/links/*`, EDIT],
  ['*', `${G}/tickets/*/subjects`, EDIT],
  ['*', `${G}/tickets/*/subjects/*`, EDIT],
  ['POST', `${G}/tickets/*/side-conversations`, ['reply.create']],
  ['POST', `${G}/tickets/*/side-conversations/**`, ['reply.create']],
  ['GET', `${G}/macros`, ['macro.view']],
  ['POST', `${G}/macros/*/execute/*`, ['macro.view', 'ticket.edit']],
  ['GET', `${G}/canned-responses`, VIEW],
  ['GET', `${G}/canned-responses/*`, VIEW],
  ['*', `${STAFF}/saved-views`, VIEW],
  ['*', `${STAFF}/saved-views/**`, VIEW],
  ['GET', '/escalated/attachments/**', VIEW],

  // ---- Live chat ---------------------------------------------------------
  ['GET', `${G}/chat/**`, VIEW],
  ['POST', `${G}/chat/**`, ['reply.create']],

  // ---- Reports -----------------------------------------------------------
  ['GET', `${A}/reports/export/**`, ['report.export']],
  ['GET', `${A}/reports`, ['report.view']],
  ['GET', `${A}/reports/**`, ['report.view']],

  // ---- Knowledge base (screens and JSON) ---------------------------------
  ['GET', `${A}/kb-articles/create`, ['kb.create']],
  ['GET', `${A}/kb-articles/*/edit`, ['kb.edit']],
  ['GET', `${A}/{kb-articles,kb-categories,kb/articles,kb/categories}`, ['kb.view']],
  ['GET', `${A}/kb/articles/*`, ['kb.view']],
  ['POST', `${A}/{kb-articles,kb/articles}`, ['kb.create']],
  ['PUT', `${A}/{kb-articles,kb/articles}/*`, ['kb.edit']],
  ['*', `${A}/{kb-categories,kb/categories}`, ['kb.edit']],
  ['PUT', `${A}/{kb-categories,kb/categories}/*`, ['kb.edit']],
  ['DELETE', `${A}/{kb-articles,kb-categories,kb/articles,kb/categories}/*`, ['kb.delete']],

  // ---- Departments -------------------------------------------------------
  ['GET', `${A}/departments/create`, ['department.create']],
  ['GET', `${A}/departments/*/edit`, ['department.edit']],
  ['GET', `${A}/departments`, ['department.view']],
  ['POST', `${A}/departments`, ['department.create']],
  ['PUT', `${A}/departments/*`, ['department.edit']],
  ['DELETE', `${A}/departments/*`, ['department.delete']],

  // ---- Macros: anyone who may create one may save it; edits manage ---------
  ['GET', `${A}/macros`, ['macro.view']],
  ['GET', `${A}/macros/*`, ['macro.view']],
  ['POST', `${A}/macros`, ['macro.create']],
  ['*', `${A}/macros/**`, ['macro.manage']],

  // ---- Custom objects: schemas manage, records data -------------------------
  ['GET', `${A}/custom-objects/*/records`, ['custom_object.view']],
  ['*', `${A}/custom-objects/*/records`, ['custom_object.data']],
  ['*', `${A}/custom-objects/*/records/**`, ['custom_object.data']],
  ...resource('custom-objects', 'custom_object'),

  // ---- Users ---------------------------------------------------------------
  ['GET', `${A}/users`, ['user.view']],
  ['*', `${A}/users/*/role`, ['user.manage']],
  ['GET', `${A}/{audit-log,audit-logs}`, ['audit.view']],

  // ---- Roles (the roles screens; GET permissions feeds the role form) -------
  ['GET', `${A}/permissions`, ['role.view']],
  ...resource('roles', 'role'),

  // ---- Plugins: the screens; plugin pages and endpoints are the plugin's ---
  ['GET', `${A}/plugins/*/**`, []],
  ['*', '/escalated/api/plugins/*', []],
  ['*', '/escalated/api/plugins/*/**', []],
  ...resource('plugins', 'plugin'),

  // ---- Admin resources: index and reads => *.view, the rest => *.manage ---
  ...resource('sla', 'sla'),
  ...resource('sla-policies', 'sla'),
  ...resource('business-hours', 'sla'),
  ...resource('escalation-rules', 'escalation'),
  ...resource('automations', 'automation'),
  ...resource('workflows', 'automation'),
  ...resource('tags', 'tag'),
  ...resource('custom-fields', 'custom_field'),
  ...resource('statuses', 'settings'),
  ...resource('agents', 'user'),
  ...resource('skills', 'user'),
  ...resource('capacity', 'user'),
  ...resource('webhooks', 'webhook'),
  ...resource('api-tokens', 'api_token'),
  ...resource('canned-responses', 'macro'),

  // ---- Settings --------------------------------------------------------------
  ['*', `${A}/import`, ['settings.manage']],
  ['*', `${A}/import/**`, ['settings.manage']],
  ['GET', `${A}/settings`, ['settings.view']],
  ['GET', `${A}/settings/**`, ['settings.view']],
  ['*', `${A}/settings`, ['settings.manage']],
  ['*', `${A}/settings/**`, ['settings.manage']],

  // ---- Newsletters (ADR 2026-05-19-newsletter-system) ------------------------
  ['*', '/admin/newsletters', ['newsletters.manage']],
  ['*', '/admin/newsletters/**', ['newsletters.manage']],
];

const compiled = new Map<string, RegExp>();

function regex(pattern: string): RegExp {
  let found = compiled.get(pattern);
  if (!found) {
    let source = '';
    for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern[i];
      if (char === '*' && pattern[i + 1] === '*') {
        source += '.+';
        i += 1;
      } else if (char === '*') {
        source += '[^/]+';
      } else if (char === '{') {
        const end = pattern.indexOf('}', i);
        source += `(?:${pattern
          .slice(i + 1, end)
          .split(',')
          .map((part) => part.replace(/[.+?^$()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        i = end;
      } else {
        source += char.replace(/[.+?^$()|[\]\\]/g, '\\$&');
      }
    }
    found = new RegExp(`^${source}$`);
    compiled.set(pattern, found);
  }
  return found;
}

/** `/a//b/` => `/a/b`: the form controllers' paths are compared in. */
export function normalizeRoutePath(path: string): string {
  const joined = ('/' + path).replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/** The slugs the route needs before looking at the request body, or null when unmapped. */
export function mappedPermissions(method: string, path: string): string[] | null {
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const route = normalizeRoutePath(path);
  for (const [methods, pattern, slugs] of ROUTE_PERMISSIONS) {
    if (methods !== '*' && !methods.split('|').includes(verb)) continue;
    if (regex(pattern).test(route)) return [...slugs];
  }
  return null;
}

export function isRouteMapped(method: string, path: string): boolean {
  return mappedPermissions(method, path) !== null;
}

/** A ticket status as the closing check needs it. */
export interface StatusRef {
  slug?: string | null;
  category?: string | null;
}

export interface RequestFacts {
  method: string;
  path: string;
  body: any;
  /** Looks up a status by slug or id (null when unknown). */
  status: (value: unknown) => Promise<StatusRef | null>;
}

async function closing(value: unknown, facts: RequestFacts): Promise<string[]> {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string' && CLOSING_STATUSES.includes(value)) return ['ticket.close'];
  const status = await facts.status(value);
  if (!status) return [];
  return CLOSING_STATUSES.includes(String(status.slug)) || status.category === 'solved'
    ? ['ticket.close']
    : [];
}

function internalReply(body: any): boolean {
  const flag = body?.isInternal ?? body?.is_internal;
  if (flag === true || flag === 'true' || flag === 1 || flag === '1') return true;
  return ['note', 'internal', 'internal_note'].includes(String(body?.type ?? ''));
}

/**
 * The slugs a request needs, or null when its route is not mapped (the
 * caller refuses it). Body-decided actions are checked per action: a status
 * change to resolved/closed/reopened (or any solved status) also needs
 * `ticket.close`, a bulk action needs its own permission, an assignee change
 * needs `ticket.assign`, and an internal reply needs `reply.create_internal`.
 */
export async function requiredPermissions(facts: RequestFacts): Promise<string[] | null> {
  let required = mappedPermissions(facts.method, facts.path);
  if (required === null) return null;
  const path = normalizeRoutePath(facts.path);
  const body = facts.body && typeof facts.body === 'object' ? facts.body : {};

  if (regex(`${STAFF}/tickets/bulk`).test(path)) {
    const action = String(body.action ?? '');
    required.push(...(BULK_ACTIONS[action] ?? []));
    if (action === 'status') required.push(...(await closing(body.value, facts)));
  } else if (regex(`${G}/tickets/*/replies`).test(path) && internalReply(body)) {
    required = ['reply.create_internal'];
  } else if (required.includes('ticket.edit')) {
    required.push(...(await closing(body.status ?? body.statusId ?? body.status_id, facts)));
    if (facts.method.toUpperCase() === 'PUT' && body.assigneeId !== undefined) {
      required.push('ticket.assign');
    }
  }

  return [...new Set(required)];
}
