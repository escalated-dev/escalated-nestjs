import { accessFeatureEnabled } from '../access/access-features';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { AgentProfile } from '../entities/agent-profile.entity';
import { EscalatedPlugin } from '../entities/plugin.entity';
import { Role } from '../entities/role.entity';
import { CANONICAL_EVENTS, LEGACY_EVENT_NAMES } from '../events/event-names';
import type {
  EscalatedPluginDefinition,
  PluginContext,
  PluginHttpOptions,
  RegisteredPlugin,
} from './plugin-definition';
import { pageRoute, registerPlugin } from './plugin-definition';
import { PluginStoreService } from './plugin-store.service';
import { PluginDomainService } from './plugin-domain.service';
import { EscalatedGateway } from '../gateway/escalated.gateway';
import { cronDue } from './cron-schedule';

/** The lifecycle actions, fired to every active plugin. */
export const PLUGIN_LIFECYCLE_ACTIONS = [
  'plugin.activated',
  'plugin.deactivated',
  'plugin.uninstalling',
] as const;

/** Timeouts per call kind, in milliseconds, as the plugin runtime has them. */
export const PLUGIN_TIMEOUTS = { action: 30_000, filter: 5_000, endpoint: 30_000, webhook: 60_000 };

export const PLUGIN_REGISTRY_PLUGINS = 'ESCALATED_REGISTERED_PLUGINS';

/**
 * Normalises the configured plugins at boot. Two plugins with one slug are a
 * configuration error, reported with both names.
 */
export function registerPlugins(definitions: EscalatedPluginDefinition[] = []): RegisteredPlugin[] {
  const plugins = definitions.map((definition) => registerPlugin(definition));
  const seen = new Map<string, string>();
  for (const plugin of plugins) {
    const other = seen.get(plugin.slug);
    if (other !== undefined) {
      throw new Error(
        `Plugins "${other}" and "${plugin.name}" share the slug "${plugin.slug}"; rename one.`,
      );
    }
    seen.set(plugin.slug, plugin.name);
  }
  return plugins;
}

export function withTimeout<T>(work: () => T | Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([Promise.resolve().then(work), timeout]).finally(() => clearTimeout(timer));
}

/** Names a plugin may not fire with `ctx.emit`: the domain events and the lifecycle. */
const RESERVED_HOOKS = new Set<string>([
  ...CANONICAL_EVENTS,
  ...Object.keys(LEGACY_EVENT_NAMES),
  ...PLUGIN_LIFECYCLE_ACTIONS,
]);

/** A plugin as the Admin/Plugins/Index screen lists it. */
export interface PluginListing {
  slug: string;
  name: string;
  description: string | null;
  version: string;
  author: string | null;
  author_url: string | null;
  homepage: string | null;
  is_active: boolean;
  activated_at: string | null;
  source: 'registered';
  provides: { menu_items: number; widgets: number; page_components: number };
}

/**
 * The plugins this host was given (`EscalatedModule.forRoot({ plugins })`),
 * their activation state in `escalated_plugins`, their lifecycle, and the
 * dispatch of hooks to the active ones. Plugins run in this process: an
 * inactive plugin is never called.
 */
@Injectable()
export class PluginRegistry {
  private readonly logger = new Logger('EscalatedPlugins');

  constructor(
    @Inject(PLUGIN_REGISTRY_PLUGINS) private readonly plugins: RegisteredPlugin[],
    @InjectRepository(EscalatedPlugin) private readonly rows: Repository<EscalatedPlugin>,
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly store: PluginStoreService,
    private readonly domain: PluginDomainService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
    @Optional() private readonly gateway?: EscalatedGateway,
  ) {}

  all(): RegisteredPlugin[] {
    return this.plugins;
  }

  find(slug: string): RegisteredPlugin | null {
    return this.plugins.find((plugin) => plugin.slug === slug) ?? null;
  }

  private async activeSlugs(): Promise<Set<string>> {
    if (!this.plugins.length) return new Set();
    const rows = await this.rows.find({ where: { isActive: true } });
    return new Set(rows.map((row) => row.slug));
  }

  /** The plugin with this slug, only when it is active. */
  async active(slug: string): Promise<RegisteredPlugin | null> {
    const plugin = this.find(slug);
    if (!plugin) return null;
    return (await this.rows.exists({ where: { slug, isActive: true } })) ? plugin : null;
  }

  async activePlugins(): Promise<RegisteredPlugin[]> {
    const active = await this.activeSlugs();
    return this.plugins.filter((plugin) => active.has(plugin.slug));
  }

  async list(): Promise<PluginListing[]> {
    const rows = this.plugins.length ? await this.rows.find() : [];
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    return this.plugins.map((plugin) => {
      const row = bySlug.get(plugin.slug);
      const definition = plugin.definition;
      return {
        slug: plugin.slug,
        name: plugin.name,
        description: definition.description ?? null,
        version: String(definition.version ?? '1.0.0'),
        author: definition.author ?? null,
        author_url: definition.homepage ?? null,
        homepage: definition.homepage ?? null,
        is_active: !!row?.isActive,
        activated_at:
          row?.isActive && row.activatedAt ? new Date(row.activatedAt).toISOString() : null,
        source: 'registered',
        provides: {
          menu_items: plugin.pages.filter((page) => page?.menu && pageRoute(page)).length,
          widgets: (definition.widgets ?? []).length,
          page_components: (definition.components ?? []).length,
        },
      };
    });
  }

  // Lifecycle

  /** Activates: the row, then `onActivate`, then `plugin.activated`. False when unknown. */
  async activate(slug: string): Promise<boolean> {
    const plugin = this.find(slug);
    if (!plugin) return false;
    const row = await this.rows.findOne({ where: { slug } });
    if (row?.isActive) return true;

    await this.rows.save(
      Object.assign(row ?? this.rows.create({ slug }), {
        isActive: true,
        activatedAt: new Date(),
        deactivatedAt: null,
      }),
    );
    await this.lifecycle(plugin, 'onActivate');
    await this.dispatchAction('plugin.activated', { plugin: plugin.name, slug });
    return true;
  }

  /** Deactivates: `plugin.deactivated` while still active, `onDeactivate`, then the row. */
  async deactivate(slug: string): Promise<boolean> {
    const plugin = this.find(slug);
    if (!plugin) return false;
    const row = await this.rows.findOne({ where: { slug } });
    if (!row?.isActive) return true;

    await this.dispatchAction('plugin.deactivated', { plugin: plugin.name, slug });
    await this.lifecycle(plugin, 'onDeactivate');
    row.isActive = false;
    row.deactivatedAt = new Date();
    await this.rows.save(row);
    return true;
  }

  /**
   * Uninstalls a registered plugin: `plugin.uninstalling`, deactivation, and
   * the row goes. The plugin stays registered (its code is in the build), and
   * its stored data stays for a reinstall.
   */
  async uninstall(slug: string): Promise<boolean> {
    const plugin = this.find(slug);
    if (!plugin) return false;
    if (await this.rows.exists({ where: { slug, isActive: true } })) {
      await this.dispatchAction('plugin.uninstalling', { plugin: plugin.name, slug });
    }
    await this.deactivate(slug);
    await this.rows.delete({ slug });
    return true;
  }

  private async lifecycle(plugin: RegisteredPlugin, hook: 'onActivate' | 'onDeactivate') {
    const callback = plugin.definition[hook];
    if (typeof callback !== 'function') return;
    try {
      await withTimeout(() => callback(this.context(plugin)), PLUGIN_TIMEOUTS.action);
    } catch (error) {
      this.logger.error(`Plugin ${plugin.name} ${hook} failed: ${(error as Error)?.message}`);
    }
  }

  // Hooks

  /**
   * Runs `hook` on every active plugin that handles it, side by side. A
   * failing or slow handler is logged and never reaches the caller.
   */
  async dispatchAction(hook: string, event: unknown): Promise<void> {
    const handlers = (await this.activePlugins())
      .map((plugin) => ({ plugin, handler: plugin.definition.actions?.[hook] }))
      .filter(({ handler }) => typeof handler === 'function');
    await Promise.all(
      handlers.map(async ({ plugin, handler }) => {
        try {
          await withTimeout(() => handler!(event, this.context(plugin)), PLUGIN_TIMEOUTS.action);
        } catch (error) {
          this.logger.error(
            `Plugin ${plugin.name} action ${hook} failed: ${(error as Error)?.message}`,
          );
        }
      }),
    );
  }

  /**
   * Passes `value` through active plugins' filters for `hook`, lowest priority
   * first. A failing or slow filter is skipped and the value carries on.
   */
  async applyFilters<T>(hook: string, value: T): Promise<T> {
    const filters = (await this.activePlugins())
      .flatMap((plugin) =>
        plugin.filters
          .filter((filter) => filter.hook === hook)
          .map((filter) => ({ plugin, filter })),
      )
      .sort((a, b) => a.filter.priority - b.filter.priority);
    let current: unknown = value;
    for (const { plugin, filter } of filters) {
      try {
        const input = current;
        current = await withTimeout(
          () => filter.handler(input, this.context(plugin)),
          PLUGIN_TIMEOUTS.filter,
        );
      } catch (error) {
        this.logger.error(
          `Plugin ${plugin.name} filter ${hook} failed: ${(error as Error)?.message}`,
        );
      }
    }
    return current as T;
  }

  // Cron

  /**
   * Runs, side by side, every schedule of every active plugin that is due in
   * the minute of `now` (UTC), each as no user under the action timeout. A
   * failing, slow or unreadable schedule is logged and never stops the others.
   */
  async runDueCron(now: Date = new Date()): Promise<void> {
    const due: Array<{
      plugin: RegisteredPlugin;
      schedule: string;
      run: (ctx: PluginContext) => unknown;
    }> = [];
    for (const plugin of await this.activePlugins()) {
      for (const [schedule, run] of Object.entries(plugin.definition.cron ?? {})) {
        if (typeof run !== 'function') continue;
        try {
          if (cronDue(schedule, now)) due.push({ plugin, schedule, run });
        } catch (error) {
          this.logger.warn(
            `Plugin ${plugin.name} cron "${schedule}" skipped: ${(error as Error)?.message}`,
          );
        }
      }
    }
    await Promise.all(
      due.map(async ({ plugin, schedule, run }) => {
        try {
          await withTimeout(() => run(this.context(plugin)), PLUGIN_TIMEOUTS.action);
        } catch (error) {
          this.logger.error(
            `Plugin ${plugin.name} cron "${schedule}" failed: ${(error as Error)?.message}`,
          );
        }
      }),
    );
  }

  // UI extensions

  /**
   * `escalated.plugins` for the shared screens: active plugins' menu items,
   * page components and dashboard widgets, without those whose capability
   * the viewer lacks, and without admin menu items for anyone but an admin.
   * `{}` when no plugin is active.
   */
  async uiExtensions(request: any, isAdmin: boolean): Promise<Record<string, unknown>> {
    const active = await this.activePlugins();
    if (!active.length) return {};
    const menuItems: Record<string, unknown>[] = [];
    const pageComponents: Record<string, Record<string, unknown>[]> = {};
    const dashboardWidgets: Record<string, unknown>[] = [];

    for (const plugin of active) {
      const { slug } = plugin;
      for (const page of plugin.pages) {
        const route = pageRoute(page);
        if (!page?.menu || !route || !page.component) continue;
        const section = page.menu.section ?? 'admin';
        if (section === 'admin' && !isAdmin) continue;
        if (!(await this.allows(request, page.capability))) continue;
        menuItems.push({
          label: page.menu.label,
          route: `/escalated/admin/plugins/${slug}/${route}`,
          icon: page.menu.icon ?? null,
          position: page.menu.position ?? 100,
          section,
          plugin: slug,
        });
      }
      for (const item of plugin.definition.components ?? []) {
        if (!item?.page || !item.slot || !item.component) continue;
        if (!(await this.allows(request, item.capability))) continue;
        const key = `${item.page}.${item.slot}`;
        (pageComponents[key] ??= []).push({
          plugin: slug,
          component: item.component,
          data: item.props ?? {},
          position: item.order ?? 100,
        });
      }
      for (const widget of plugin.definition.widgets ?? []) {
        if (!widget?.component) continue;
        if (!(await this.allows(request, widget.capability))) continue;
        const item: Record<string, unknown> = {
          id: `${slug}.${widget.component}`,
          title: widget.label,
          component: widget.component,
          plugin: slug,
          position: widget.order ?? 100,
          width: widget.size ?? 'half',
        };
        if (typeof widget.badge === 'function') {
          item.badge = await this.badge(plugin, widget.badge, request);
        }
        dashboardWidgets.push(item);
      }
    }
    return { menuItems, pageComponents, dashboardWidgets };
  }

  /** A widget's badge, asked as the viewer; `null` when it fails or is slow. */
  private async badge(
    plugin: RegisteredPlugin,
    badge: (ctx: PluginContext) => Promise<number | string | null>,
    request: any,
  ): Promise<number | string | null> {
    try {
      const answer = await withTimeout(
        () => badge(this.context(plugin, request)),
        PLUGIN_TIMEOUTS.filter,
      );
      return typeof answer === 'number' || typeof answer === 'string' ? answer : null;
    } catch (error) {
      this.logger.error(`Plugin ${plugin.name} badge failed: ${(error as Error)?.message}`);
      return null;
    }
  }

  // Access

  /**
   * Whether the request's user holds `capability`. While roles & permissions
   * is switched off the host guards decide everything and this is always
   * true; while on, the user's Escalated role must grant it (ADR
   * 2026-10-29-configurable-access-features).
   */
  async allows(request: any, capability: string | null | undefined): Promise<boolean> {
    if (!capability) return true;
    if (!accessFeatureEnabled(this.options, 'roles_permissions')) return true;
    const user = this.options.userResolver?.(request) ?? request?.user;
    const userId = user?.id ?? request?.apiUserId;
    if (userId === undefined || userId === null) return false;
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile?.roleId) return false;
    const role = await this.roles.findOne({
      where: { id: profile.roleId },
      relations: { permissions: true },
    });
    return (role?.permissions ?? []).some((p) => p.slug === capability);
  }

  // Context

  /** The `ctx` a plugin's handlers receive; everything in it is scoped to `plugin`. */
  context(plugin: RegisteredPlugin, request?: any): PluginContext {
    const name = plugin.name;
    const store = this.store;
    const logger = this.logger;
    const log =
      (level: 'log' | 'warn' | 'error' | 'debug') =>
      (message: string, data?: unknown): void => {
        logger[level](`[${name}] ${message}${data === undefined ? '' : ` ${safeJson(data)}`}`);
      };
    const domain = this.domain;
    const gateway = this.gateway;
    const broadcast = async (
      to: { channel: string } | { userId: any } | { ticketId: number },
      event: unknown,
      data: unknown,
    ): Promise<void> => {
      if (typeof event !== 'string' || !event) throw new Error('ctx.broadcast requires event');
      // Without the gateway (`enableWebsockets` off) there is nobody to tell.
      if (!gateway) return;
      await gateway.pluginBroadcast(to, event, data);
    };
    const actor = () => {
      const user = request ? (this.options.userResolver?.(request) ?? request.user) : null;
      return user?.id ?? request?.apiUserId ?? null;
    };

    return {
      config: {
        get: (key) => store.configGet(name, key),
        set: (data) => store.configSet(name, data),
        all: () => store.configAll(name),
      },
      store: {
        get: (collection, key) => store.get(name, collection, key),
        set: (collection, key, value) => store.set(name, collection, key, value),
        query: (collection, filter, options) => store.query(name, collection, filter, options),
        insert: (collection, data) => store.insert(name, collection, data),
        update: (collection, key, data) => store.update(name, collection, key, data),
        delete: (collection, key) => store.delete(name, collection, key),
      },
      http: httpClient(),
      broadcast: {
        toChannel: async (channel, event, data) => {
          if (typeof channel !== 'string' || !channel) {
            throw new Error('ctx.broadcast.toChannel requires channel');
          }
          await broadcast({ channel }, event, data);
        },
        toUser: async (userId, event, data) => {
          if (userId === undefined || userId === null || userId === '') {
            throw new Error('ctx.broadcast.toUser requires userId');
          }
          await broadcast({ userId }, event, data);
        },
        toTicket: async (ticketId, event, data) => {
          const id = Number(ticketId);
          if (!Number.isInteger(id) || id <= 0) {
            throw new Error('ctx.broadcast.toTicket requires ticketId');
          }
          await broadcast({ ticketId: id }, event, data);
        },
      },
      log: {
        info: log('log'),
        warn: log('warn'),
        error: log('error'),
        debug: log('debug'),
      },
      tickets: {
        find: (id: unknown) => domain.findTicket(id),
        query: (filter: unknown) => domain.queryTickets(filter),
        create: (data: unknown) => domain.createTicket(data, actor()),
        update: (id: unknown, data: unknown) => domain.updateTicket(id, data, actor()),
      },
      replies: {
        find: (id: unknown) => domain.findReply(id),
        query: (filter: unknown) => domain.queryReplies(filter),
        create: (data: unknown) => domain.createReply(data, actor()),
      },
      contacts: {
        find: (id: unknown) => domain.findContact(id),
        findByEmail: (email: unknown) => domain.findContactByEmail(email),
        create: (data: unknown) => domain.createContact(data),
      },
      tags: {
        all: () => domain.allTags(),
        create: (data: unknown) => domain.createTag(data),
      },
      departments: {
        all: () => domain.allDepartments(),
        find: (id: unknown) => domain.findDepartment(id),
      },
      agents: {
        all: () => domain.allAgents(),
        find: (id: unknown) => domain.findAgent(id),
      },
      emit: async (hook, data) => {
        if (typeof hook !== 'string' || RESERVED_HOOKS.has(hook)) {
          log('warn')(`ctx.emit("${String(hook)}") dropped: that name belongs to the host`);
          return;
        }
        await this.dispatchAction(hook, data);
      },
      currentUser: async () => {
        if (!request) return null;
        const user = this.options.userResolver?.(request) ?? request.user;
        if (!user || user.id === undefined || user.id === null) return null;
        return {
          id: user.id,
          name: typeof user.name === 'string' ? user.name : null,
          email: typeof user.email === 'string' ? user.email : null,
        };
      },
    };
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** `ctx.http`: outbound requests from this process, as the plugin runtime makes them. */
function httpClient(): PluginContext['http'] {
  const request = async (url: string, method: string, options: PluginHttpOptions = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let body: string | undefined;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers['Content-Type'] = 'application/json';
    } else if (options.body !== undefined) {
      body = options.body;
    }
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: options.timeout ? AbortSignal.timeout(options.timeout) : undefined,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      json: () => response.json(),
      text: () => response.text(),
    };
  };
  return {
    get: (url, options) => request(url, 'GET', options),
    post: (url, options) => request(url, 'POST', options),
    put: (url, options) => request(url, 'PUT', options),
    delete: (url, options) => request(url, 'DELETE', options),
  };
}
