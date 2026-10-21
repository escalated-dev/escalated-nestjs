import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { isObservable, lastValueFrom } from 'rxjs';
import type { EscalatedModuleOptions } from '../config/escalated.config';
import { ESCALATED_ROUTE_GROUP } from '../guards/escalated-route.guard';
import { SettingsService } from '../services/settings.service';
import { clearFlashCookie, flashCookie, readFlash, type FlashState } from './flash';
import { InertiaBack, InertiaPage, InertiaRedirect } from './inertia';
import { isInertiaRequest, requestUrl, sameOriginReferer } from './request';
import { defaultRootView } from './root-view';
import { escalatedRoutes, ESCALATED_UI_PREFIX } from './routes';
import type { InertiaPageObject } from './ui-options';

/** A response the Inertia filter writes out as-is. */
export interface InertiaReply {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

function method(request: any): string {
  return String(request?.method ?? 'GET').toUpperCase();
}

function origin(request: any): string {
  const protocol = request?.protocol ?? (request?.secure ? 'https' : 'http');
  return `${protocol}://${request?.headers?.host ?? 'localhost'}`;
}

function present(id: unknown): boolean {
  return (typeof id === 'number' || typeof id === 'string') && id !== '' && String(id) !== '0';
}

/**
 * Builds Inertia responses: the page object with the shared props, the asset
 * version check, partial reloads, flash data and redirects.
 */
export class InertiaResponder {
  private readonly guards = new Map<new (...args: any[]) => CanActivate, Promise<CanActivate>>();

  constructor(
    private readonly options: EscalatedModuleOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get ui() {
    return this.options.ui ?? {};
  }

  async version(): Promise<string> {
    const version = this.ui.version;
    if (typeof version === 'function') return String((await version()) ?? '');
    return String(version ?? '');
  }

  async page(page: InertiaPage, request: any, context: ExecutionContext): Promise<InertiaReply> {
    const version = await this.version();
    const inertia = isInertiaRequest(request);

    if (
      inertia &&
      method(request) === 'GET' &&
      String(request.headers?.['x-inertia-version'] ?? '') !== version
    ) {
      return {
        status: 409,
        headers: { 'X-Inertia-Location': origin(request) + requestUrl(request) },
      };
    }

    const headers: Record<string, string> = { Vary: 'X-Inertia' };
    const flash = readFlash(request);
    if (flash) headers['Set-Cookie'] = clearFlashCookie(request);

    const props = this.partial(
      page.component,
      request,
      await this.shared(request, context, flash ?? { flash: {}, errors: {} }),
      page.props,
    );

    const pageObject: InertiaPageObject = {
      component: page.component,
      props,
      url: requestUrl(request),
      version,
      encryptHistory: false,
      clearHistory: false,
      flash: flash?.flash ?? {},
    };

    if (inertia) {
      return {
        status: 200,
        headers: { ...headers, 'X-Inertia': 'true', 'Content-Type': 'application/json' },
        body: pageObject,
      };
    }

    const html = this.ui.rootView
      ? await this.ui.rootView(pageObject, request)
      : defaultRootView(pageObject, this.ui, this.options.appName);
    return {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  }

  redirect(target: InertiaRedirect, request: any): InertiaReply {
    let url: string;
    let state: FlashState;
    if (target instanceof InertiaBack) {
      url = sameOriginReferer(request) ?? target.fallback;
      state = { flash: { ...target.flash }, errors: { ...target.errors } };
    } else {
      const { redirect, ...extra } = target as unknown as Record<string, unknown>;
      url = String(redirect ?? '/');
      state = { flash: extra, errors: {} };
    }

    // 303 after anything but GET, so the browser follows with a GET (Inertia protocol).
    const headers: Record<string, string> = { Location: url };
    if (Object.keys(state.flash).length || Object.keys(state.errors).length) {
      headers['Set-Cookie'] = flashCookie(request, state);
    }
    return { status: method(request) === 'GET' ? 302 : 303, headers };
  }

  /** `back()` with validation errors, for a form the client must re-show. */
  invalid(request: any, fallback: string, errors: Record<string, string>): InertiaReply {
    return this.redirect(new InertiaBack(fallback, {}, errors), request);
  }

  private partial(
    component: string,
    request: any,
    shared: Record<string, unknown>,
    props: Record<string, unknown>,
  ): Record<string, unknown> {
    const all: Record<string, unknown> = { ...shared, ...props };
    if (String(request.headers?.['x-inertia-partial-component'] ?? '') !== component) return all;

    const list = (name: string) =>
      String(request.headers?.[name] ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    const only = list('x-inertia-partial-data');
    const except = list('x-inertia-partial-except');

    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(all)) {
      if (key === 'errors' || ((!only.length || only.includes(key)) && !except.includes(key))) {
        kept[key] = value;
      }
    }
    return kept;
  }

  /** The props every screen gets, as Laravel's `HandleInertiaRequests` + `shareInertiaData` share them. */
  async shared(
    request: any,
    context: ExecutionContext,
    flash: FlashState,
  ): Promise<Record<string, unknown>> {
    const user = this.user(request);
    const group = request?.[ESCALATED_ROUTE_GROUP];
    const isAdmin = group === 'admin' || (await this.admits('admin', user, request, context));
    const isAgent =
      isAdmin || group === 'agent' || (await this.admits('agent', user, request, context));

    const shared: Record<string, unknown> = {
      auth: { user },
      flash: { success: null, error: null, ...flash.flash },
      errors: flash.errors,
      escalated: {
        prefix: ESCALATED_UI_PREFIX,
        broadcasting: { channel_prefix: '' },
        is_agent: isAgent,
        is_admin: isAdmin,
        permissions: [],
        features: { newsletters: this.options.enableNewsletters === true },
        guest_tickets_enabled: true,
        show_powered_by: await this.setting('show_powered_by', true),
        knowledge_base_enabled: this.options.enableKnowledgeBase !== false,
        knowledge_base_public: true,
        knowledge_base_feedback_enabled: true,
        agent_type: 'full',
      },
      ziggy: {
        url: origin(request),
        port: null,
        defaults: {},
        routes: escalatedRoutes(),
        location: origin(request) + requestUrl(request),
      },
    };

    const extra = this.ui.share ? await this.ui.share(request) : {};
    return { ...shared, ...(extra ?? {}) };
  }

  private user(request: any): { id: unknown; name: string | null; email: string | null } | null {
    const user = this.options.userResolver?.(request) ?? request?.user;
    const id = present(user?.id) ? user.id : request?.apiUserId;
    if (!present(id)) return null;
    return {
      id,
      name: typeof user?.name === 'string' ? user.name : null,
      email: typeof user?.email === 'string' ? user.email : null,
    };
  }

  /**
   * Whether the user is an admin/agent: from `ticketAccess.resolveUser` when
   * configured, else by asking the host guard for that group. A guard that
   * throws or refuses means no.
   */
  private async admits(
    group: 'admin' | 'agent',
    user: { id: unknown } | null,
    request: any,
    context: ExecutionContext,
  ): Promise<boolean> {
    if (!user) return false;
    const resolveUser = this.options.ticketAccess?.resolveUser;
    if (resolveUser) {
      try {
        const actor = await resolveUser(user.id as any);
        return group === 'admin' ? !!actor?.isAdmin : !!(actor?.isAgent || actor?.isAdmin);
      } catch {
        return false;
      }
    }

    const hostGuard = this.options[group === 'admin' ? 'adminGuard' : 'agentGuard'];
    if (!hostGuard) return false;
    const groupBefore = request?.[ESCALATED_ROUTE_GROUP];
    try {
      const guard: CanActivate =
        typeof hostGuard === 'function'
          ? await this.instance(hostGuard as new (...args: any[]) => CanActivate)
          : hostGuard;
      const result = guard.canActivate(context);
      return Boolean(isObservable(result) ? await lastValueFrom(result) : await result);
    } catch {
      return false;
    } finally {
      if (request) request[ESCALATED_ROUTE_GROUP] = groupBefore;
    }
  }

  private instance(type: new (...args: any[]) => CanActivate): Promise<CanActivate> {
    let instance = this.guards.get(type);
    if (!instance) {
      instance = (async () => {
        try {
          return this.moduleRef.get(type, { strict: false });
        } catch {
          return this.moduleRef.create(type);
        }
      })();
      this.guards.set(type, instance);
    }
    return instance;
  }

  private async setting(key: string, fallback: boolean): Promise<boolean> {
    try {
      const settings = this.moduleRef.get(SettingsService, { strict: false });
      return Boolean(await settings.getTyped<boolean>(key, fallback));
    } catch {
      return fallback;
    }
  }
}
