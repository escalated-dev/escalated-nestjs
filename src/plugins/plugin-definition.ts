/**
 * The shape of an `@escalated-dev/plugin-sdk` plugin, as `definePlugin()`
 * returns it, declared here structurally so the package needs no dependency
 * on the SDK: a host passes `definePlugin({...})` objects (or plain objects of
 * the same shape) as `EscalatedModule.forRoot({ plugins: [...] })`, and they
 * run in this process. See domain-model/plugin-contract.md in
 * escalated-developer-context.
 */

export interface PluginConfigField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
}

export interface PluginMenuDeclaration {
  label: string;
  section?: 'admin' | 'agent';
  position?: number;
  icon?: string;
}

export interface PluginPageDeclaration {
  route: string;
  component: string;
  layout?: 'admin' | 'agent' | 'public';
  capability?: string;
  menu?: PluginMenuDeclaration;
}

export interface PluginComponentDeclaration {
  page: string;
  slot: string;
  component: string;
  props?: Record<string, unknown>;
  order?: number;
  capability?: string;
}

export interface PluginWidgetDeclaration {
  component: string;
  label: string;
  size?: 'full' | 'half' | 'quarter';
  order?: number;
  capability?: string;
  badge?: (ctx: PluginContext) => Promise<number | string | null>;
}

/** What an endpoint or webhook handler receives (the SDK's `EndpointRequest`). */
export interface PluginRequest {
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  httpContract?: 1;
  /** The exact request bytes, when the app was created with `rawBody: true`. */
  rawBody?: Uint8Array;
  clientIp?: string;
}

export type PluginRouteHandler = (ctx: PluginContext, req: PluginRequest) => unknown;

export type PluginEndpointDefinition =
  PluginRouteHandler | { capability?: string; handler: PluginRouteHandler };

export type PluginActionHandler = (event: any, ctx: PluginContext) => unknown;
export type PluginFilterHandler = (value: any, ctx: PluginContext) => unknown;
export type PluginFilterDefinition =
  PluginFilterHandler | { priority?: number; handler: PluginFilterHandler };

export interface PluginQueryOptions {
  limit?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

/** The SDK's `PluginContext`, as this host builds it. */
export interface PluginContext {
  config: {
    get(key: string): Promise<unknown>;
    set(data: Record<string, unknown>): Promise<void>;
    all(): Promise<Record<string, unknown>>;
  };
  store: {
    get(collection: string, key: string): Promise<unknown>;
    set(collection: string, key: string, value: unknown): Promise<void>;
    query(
      collection: string,
      filter?: Record<string, unknown>,
      options?: PluginQueryOptions,
    ): Promise<Record<string, unknown>[]>;
    insert(collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
    update(
      collection: string,
      key: string,
      data: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
    delete(collection: string, key: string): Promise<void>;
  };
  http: {
    get(url: string, options?: PluginHttpOptions): Promise<PluginHttpResponse>;
    post(url: string, options?: PluginHttpOptions): Promise<PluginHttpResponse>;
    put(url: string, options?: PluginHttpOptions): Promise<PluginHttpResponse>;
    delete(url: string, options?: PluginHttpOptions): Promise<PluginHttpResponse>;
  };
  broadcast: {
    toChannel(channel: string, event: string, data: unknown): Promise<void>;
    toUser(userId: string | number, event: string, data: unknown): Promise<void>;
    toTicket(ticketId: string | number, event: string, data: unknown): Promise<void>;
  };
  log: {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    debug(message: string, data?: unknown): void;
  };
  tickets: Record<string, (...args: any[]) => Promise<any>>;
  replies: Record<string, (...args: any[]) => Promise<any>>;
  contacts: Record<string, (...args: any[]) => Promise<any>>;
  tags: Record<string, (...args: any[]) => Promise<any>>;
  departments: Record<string, (...args: any[]) => Promise<any>>;
  agents: Record<string, (...args: any[]) => Promise<any>>;
  emit(hook: string, data: unknown): Promise<void>;
  currentUser(): Promise<{ id: unknown; name: string | null; email: string | null } | null>;
}

export interface PluginHttpOptions {
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  timeout?: number;
}

export interface PluginHttpResponse {
  status: number;
  headers: Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface EscalatedPluginDefinition {
  name: string;
  version: string;
  description?: string;
  /** Not in the SDK's type; shown on the admin screen when present. */
  author?: string;
  /** Not in the SDK's type; linked from the admin screen when present. */
  homepage?: string;
  config?: PluginConfigField[];
  onActivate?: (ctx: PluginContext) => unknown;
  onDeactivate?: (ctx: PluginContext) => unknown;
  actions?: Record<string, PluginActionHandler>;
  filters?: Record<string, PluginFilterDefinition>;
  pages?: PluginPageDeclaration[];
  components?: PluginComponentDeclaration[];
  widgets?: PluginWidgetDeclaration[];
  endpoints?: Record<string, PluginEndpointDefinition>;
  webhooks?: Record<string, PluginRouteHandler>;
  cron?: Record<string, (ctx: PluginContext) => unknown>;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

/** One endpoint or webhook route, parsed from its `METHOD /path` key. */
export interface PluginRoute {
  method: string;
  /** The manifest path, which is what the plugin is dispatched on. */
  path: string;
  capability: string | null;
  handler: PluginRouteHandler;
  matcher: RegExp;
  params: string[];
}

/** A registered plugin, with its routes and hooks normalised once at boot. */
export interface RegisteredPlugin {
  slug: string;
  name: string;
  definition: EscalatedPluginDefinition;
  pages: PluginPageDeclaration[];
  endpoints: PluginRoute[];
  webhooks: PluginRoute[];
  filters: Array<{ hook: string; priority: number; handler: PluginFilterHandler }>;
}

/**
 * The plugin's slug: what goes in URLs, route names and `escalated_plugins`.
 * `@escalated-dev/plugin-slack` is `escalated-dev--plugin-slack`.
 */
export function pluginSlug(name: string): string {
  return name
    .replace(/^@/, '')
    .replace(/\//g, '--')
    .replace(/[^A-Za-z0-9_-]/g, '-');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses `METHOD /path` as escalated-laravel's RouteRegistrar does, refusing
 * unknown methods and paths that are not absolute or contain `..`, control
 * characters, `?`, `#` or a backslash.
 */
function parseRoute(
  plugin: string,
  key: string,
  handler: PluginRouteHandler,
  capability: string | null,
): PluginRoute {
  const parts = key.trim().split(' ');
  const method = String(parts[0] ?? '').toUpperCase();
  const path = parts.slice(1).join(' ');
  if (
    parts.length !== 2 ||
    !METHODS.includes(method) ||
    !path.startsWith('/') ||
    /[\x00-\x20\x7f?#\\]/.test(path) ||
    path.split('/').includes('..')
  ) {
    throw new Error(`Plugin ${plugin}: route "${key}" is not "METHOD /path".`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`Plugin ${plugin}: route "${key}" has no handler.`);
  }
  const params: string[] = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      const param = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(segment);
      if (!param) return escapeRegex(segment);
      params.push(param[1]);
      return '([^/]+)';
    })
    .join('/');
  return { method, path, capability, handler, matcher: new RegExp(`^${pattern}$`), params };
}

/** Validates a definition and normalises it, throwing on anything malformed. */
export function registerPlugin(definition: EscalatedPluginDefinition): RegisteredPlugin {
  if (!definition || typeof definition !== 'object') {
    throw new Error('A plugin must be a definePlugin() object.');
  }
  if (typeof definition.name !== 'string' || !definition.name.trim()) {
    throw new Error('A plugin needs a name.');
  }
  const name = definition.name;

  const endpoints = Object.entries(definition.endpoints ?? {}).map(([key, value]) =>
    typeof value === 'function'
      ? parseRoute(name, key, value, null)
      : parseRoute(name, key, value?.handler, value?.capability ?? null),
  );
  const webhooks = Object.entries(definition.webhooks ?? {}).map(([key, handler]) =>
    parseRoute(name, key, handler, null),
  );
  const filters = Object.entries(definition.filters ?? {}).map(([hook, value]) => {
    const handler = typeof value === 'function' ? value : value?.handler;
    if (typeof handler !== 'function') {
      throw new Error(`Plugin ${name}: filter "${hook}" has no handler.`);
    }
    const priority = typeof value === 'function' ? 10 : (value.priority ?? 10);
    return { hook, priority, handler };
  });

  return {
    slug: pluginSlug(name),
    name,
    definition,
    pages: definition.pages ?? [],
    endpoints,
    webhooks,
    filters,
  };
}

/** The route matching `method` and `path`, with its params. */
export function matchRoute(
  routes: PluginRoute[],
  method: string,
  path: string,
): { route: PluginRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method.toUpperCase()) continue;
    const match = route.matcher.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    try {
      route.params.forEach((param, index) => {
        params[param] = decodeURIComponent(match[index + 1]);
      });
    } catch {
      return null; // A malformed escape matches nothing.
    }
    return { route, params };
  }
  return null;
}

/** A page's route with leading slashes removed; empty means none. */
export function pageRoute(page: PluginPageDeclaration): string {
  return String(page?.route ?? '').replace(/^\/+/, '');
}
