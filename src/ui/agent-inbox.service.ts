import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import { hasSession } from '../access/two-factor-session';
import { SavedView } from '../entities/saved-view.entity';
import { flag, UiDataService } from './ui-data.service';

export type Filters = Record<string, any>;

export interface InboxView {
  id: number | string;
  name: string;
  filters: Filters;
}

/** A queue: its key and title, and its own filters (what its counts and stats are over). */
export interface InboxQueue {
  key: string;
  title: string;
  filters: Filters;
}

export interface InboxSummary {
  counts: { mine: number; unassigned: number; all: number };
  views: Array<{ id: number | string; name: string; count: number; filters: Filters }>;
  stats: { open: number; urgent: number; sla_at_risk: number; resolved_today: number };
}

/** Where the queue last opened in the list is kept, in the host's session or a cookie. */
export const QUEUE_SESSION_KEY = 'escalatedAgentQueue';
export const QUEUE_COOKIE = 'escalated_agent_queue';

/** Saved views beyond this many are not listed, so the counts stay bounded. */
export const MAX_SAVED_VIEWS = 50;

/** Query keys that pick a page or an order, never which tickets are in a queue. */
const PRESENTATION_KEYS = ['page', 'per_page', 'view'];

const QUEUE_TITLES: Record<string, string> = {
  mine: 'My inbox',
  unassigned: 'Unassigned',
  all: 'All tickets',
};

const BUILT_IN_NAMES: Record<string, string> = {
  urgent: 'Urgent',
  sla_at_risk: 'SLA at risk',
  waiting_on_me: 'Waiting on me',
  waiting_on_customer: 'Waiting on customer',
  recently_updated: 'Recently updated',
};

/**
 * The agent panel's `inbox` and `queue` props (shared frontend
 * docs/agent-panel.md), as escalated-laravel's AgentInbox sends them.
 *
 * Every number is a count over the same filters the ticket list applies,
 * inside the request's ticket-access scope, so it is what the agent would
 * see by opening that list. Rail counts (`counts`, `views`) are of
 * unresolved, unsnoozed tickets; `stats` are for the current queue.
 */
@Injectable()
export class AgentInboxService {
  private readonly cache = new Map<string, { expires: number; value: InboxSummary }>();

  constructor(
    private readonly data: UiDataService,
    @InjectRepository(SavedView) private readonly savedViews: Repository<SavedView>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  /** Translate `assigned=me` and `assigned_to=me` into the agent's id. */
  normaliseFilters(filters: Filters, agent: UserId): Filters {
    const out: Filters = { ...filters };
    if (out.assigned === 'me' || out.assigned_to === 'me') out.assigned_to = agent;
    delete out.assigned;
    return out;
  }

  /** The queue a list request shows. */
  async queueFor(filters: Filters, agent: UserId): Promise<InboxQueue> {
    const views = await this.views(agent);

    if (filters.view != null && filters.view !== '') {
      const view = views.find((v) => String(v.id) === String(filters.view));
      if (view) return this.viewQueue(view);
    }

    const selection = comparable(filters);
    if (Object.keys(selection).length) {
      const key = JSON.stringify(selection);
      const view = views.find(
        (v) => Object.keys(v.filters).length && JSON.stringify(comparable(v.filters)) === key,
      );
      if (view) return this.viewQueue(view);
    }

    if (filters.assigned_to != null && String(filters.assigned_to) === String(agent)) {
      return this.workspaceQueue('mine', agent);
    }
    if (flag(filters.unassigned)) {
      return this.workspaceQueue('unassigned', agent);
    }
    return this.workspaceQueue('all', agent);
  }

  /** The filters the list applies: the request's, over a view picked by id. */
  listFilters(filters: Filters, queue: InboxQueue): Filters {
    if (filters.view != null && queue.key.startsWith('view:')) {
      const rest = { ...filters };
      delete rest.view;
      return { ...queue.filters, ...rest };
    }
    return filters;
  }

  /** Remember the queue for the ticket page, which is opened from the list. */
  remember(request: any, queue: InboxQueue): void {
    if (hasSession(request)) {
      request.session[QUEUE_SESSION_KEY] = queue.key;
      return;
    }
    const response = request?.res;
    if (typeof response?.append !== 'function') return;
    const secure = request?.secure || request?.protocol === 'https' ? '; Secure' : '';
    response.append(
      'Set-Cookie',
      `${QUEUE_COOKIE}=${encodeURIComponent(queue.key)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    );
  }

  /** The queue last shown in the list, or All tickets. Only the key is kept, and it is re-checked. */
  async recalled(request: any, agent: UserId): Promise<InboxQueue> {
    let key: unknown = hasSession(request) ? request.session[QUEUE_SESSION_KEY] : undefined;
    if (key == null) key = cookieValue(request, QUEUE_COOKIE);
    if (typeof key !== 'string') return this.workspaceQueue('all', agent);

    if (key.startsWith('view:')) {
      // The view may have been deleted or unshared since.
      const id = key.slice(5);
      const view = (await this.views(agent)).find((v) => String(v.id) === id);
      return view ? this.viewQueue(view) : this.workspaceQueue('all', agent);
    }
    return this.workspaceQueue(key, agent);
  }

  /** The `queue` prop. */
  queueProp(queue: InboxQueue): { key: string; title: string } {
    return { key: queue.key, title: queue.title };
  }

  /** The `inbox` prop for this agent and queue, cached per agent and queue. */
  async summary(agent: UserId, queue: InboxQueue): Promise<InboxSummary> {
    const seconds = Number(this.options?.ui?.agentInbox?.cacheSeconds ?? 10);
    if (!(seconds > 0)) return this.build(agent, queue);

    const key = JSON.stringify([String(agent), queue.key, comparable(queue.filters)]);
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) return hit.value;

    const value = await this.build(agent, queue);
    for (const [stale, entry] of this.cache) if (entry.expires <= now) this.cache.delete(stale);
    this.cache.set(key, { expires: now + seconds * 1000, value });
    return value;
  }

  /** Built-in views, then the agent's own and shared saved views. */
  async views(agent: UserId): Promise<InboxView[]> {
    const builtIn: InboxView[] = [
      { id: 'urgent', filters: { priority: 'urgent', open: 1 } },
      { id: 'sla_at_risk', filters: { sla_at_risk: 1 } },
      { id: 'waiting_on_me', filters: { assigned_to: agent, status: 'waiting_on_agent' } },
      { id: 'waiting_on_customer', filters: { assigned_to: agent, status: 'waiting_on_customer' } },
      {
        id: 'recently_updated',
        filters: { open: 1, updated_within_hours: 24, sort_by: 'updated_at' },
      },
    ].map((view) => ({ ...view, name: BUILT_IN_NAMES[view.id] }));

    const saved = await this.savedViews
      .createQueryBuilder('view')
      .where(
        new Brackets((q) =>
          q
            .where('view.userId = :me', { me: agent })
            .orWhere('view.isShared = :shared', { shared: true })
            .orWhere('view.userId IS NULL'),
        ),
      )
      .orderBy('view.sortOrder', 'ASC')
      .addOrderBy('view.id', 'ASC')
      .take(MAX_SAVED_VIEWS)
      .getMany();

    return [
      ...builtIn,
      ...saved.map((view) => ({
        id: view.id,
        name: view.name,
        filters: this.normaliseFilters(
          view.filters && typeof view.filters === 'object' && !Array.isArray(view.filters)
            ? view.filters
            : {},
          agent,
        ),
      })),
    ];
  }

  private async build(agent: UserId, queue: InboxQueue): Promise<InboxSummary> {
    const base = queue.filters;
    const views = await this.views(agent);
    return {
      counts: {
        mine: await this.countOpen({ assigned_to: agent }, agent),
        unassigned: await this.countOpen({ unassigned: 1 }, agent),
        all: await this.countOpen({}, agent),
      },
      views: await Promise.all(
        views.map(async (view) => ({
          id: view.id,
          name: view.name,
          count: await this.countOpen(view.filters, agent),
          filters: view.filters,
        })),
      ),
      // Each stat is the list the tile opens: the queue plus the tile's filters.
      stats: {
        open: await this.data.ticketCount({ ...base, status: 'open' }, agent),
        urgent: await this.data.ticketCount({ ...base, priority: 'urgent', open: 1 }, agent),
        sla_at_risk: await this.data.ticketCount({ ...base, sla_at_risk: 1 }, agent),
        resolved_today: await this.data.ticketCount(
          { ...base, status: 'resolved', resolved_today: 1 },
          agent,
        ),
      },
    };
  }

  /** Unresolved tickets, unless the filters ask for a status themselves. */
  private countOpen(filters: Filters, agent: UserId): Promise<number> {
    return this.data.ticketCount(filters.status ? filters : { ...filters, open: 1 }, agent);
  }

  private viewQueue(view: InboxView): InboxQueue {
    return { key: `view:${view.id}`, title: view.name, filters: view.filters };
  }

  private workspaceQueue(key: string, agent: UserId): InboxQueue {
    if (key === 'mine') return { key, title: QUEUE_TITLES.mine, filters: { assigned_to: agent } };
    if (key === 'unassigned') {
      return { key, title: QUEUE_TITLES.unassigned, filters: { unassigned: 1 } };
    }
    return { key: 'all', title: QUEUE_TITLES.all, filters: {} };
  }
}

const BOOLEAN = ['0', '1', 'true', 'false', 'on', 'off', 'yes', 'no', ''];

/**
 * Field errors for the list filters added for the agent panel (`open`,
 * `sla_at_risk`, `resolved_today` booleans; `updated_within_hours` 1..8760),
 * or null when they are valid, as escalated-laravel validates them.
 */
export function listFilterErrors(query: Filters): Record<string, string> | null {
  const errors: Record<string, string> = {};
  for (const key of ['open', 'sla_at_risk', 'resolved_today']) {
    if (query[key] != null && !BOOLEAN.includes(String(query[key]).toLowerCase())) {
      errors[key] = `The ${key.replace(/_/g, ' ')} field must be true or false.`;
    }
  }
  const hours = query.updated_within_hours;
  if (hours != null && hours !== '') {
    const number = Number(hours);
    if (!/^\d+$/.test(String(hours)) || number < 1 || number > 8760) {
      errors.updated_within_hours =
        'The updated within hours field must be a whole number from 1 to 8760.';
    }
  }
  return Object.keys(errors).length ? errors : null;
}

/** Filters as strings, without empty values or order, for comparing a URL with a view. */
function comparable(filters: Filters): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === '' || value == null || value === false || PRESENTATION_KEYS.includes(key)) {
      continue;
    }
    clean[key] = Array.isArray(value)
      ? value.map(String).sort().join(',')
      : String(value === true ? 1 : value);
  }
  return clean;
}

function cookieValue(request: any, name: string): string | undefined {
  for (const part of String(request?.headers?.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
