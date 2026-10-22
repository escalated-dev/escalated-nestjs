import type { UserId } from '../config/user-id-column';

/** The Inertia page object, as sent to the client. */
export interface InertiaPageObject {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string;
  encryptHistory: boolean;
  clearHistory: boolean;
  /** Inertia 3 reads flash data from the page; older clients read `props.flash`. */
  flash?: Record<string, unknown>;
}

/** A host user as the screens show it. */
export interface EscalatedUiUser {
  id: UserId;
  name?: string | null;
  email?: string | null;
}

/** A host user as `Admin/Users/Index` lists it, with their Escalated access. */
export interface EscalatedUiHostUser extends EscalatedUiUser {
  /** Whether the user is an Escalated admin. */
  isAdmin?: boolean;
  /** Whether the user is an Escalated agent. */
  isAgent?: boolean;
}

/** What `Admin/Users/Index` asks `ui.listUsers` for. */
export interface EscalatedUiUserQuery {
  /** The search box's text, trimmed; `''` for none. Match it against name and email. */
  search: string;
  /** The 1-based page. */
  page: number;
  /** Users per page (20, as escalated-laravel). */
  perPage: number;
}

/** One page of host users, and how many match the search in all. */
export interface EscalatedUiUserPage {
  data: EscalatedUiHostUser[];
  total: number;
}

/**
 * A change to a user's Escalated access. Only the keys present change. The
 * package applies escalated-laravel's rules before calling the hook: granting
 * admin also grants agent, and revoking agent also revokes admin.
 */
export interface EscalatedUiRoleChange {
  isAdmin?: boolean;
  isAgent?: boolean;
}

export interface EscalatedUiOptions {
  /**
   * Serve the shared screens. Default `false`: the package stays API-only and
   * no page routes are registered. escalated-laravel defaults this to `true`;
   * this default will flip in a future minor release.
   */
  enabled?: boolean;

  /**
   * Renders the HTML document for a first (non-Inertia) visit. Put the page
   * object into the document the way your Inertia client reads it. The default
   * view (`defaultRootView`) writes a minimal document with the `scripts` and
   * `styles` below, the page in both forms Inertia 1-3 read, and a `route()`
   * helper for the shared components.
   */
  rootView?: (page: InertiaPageObject, request: any) => string | Promise<string>;

  /**
   * The asset version (Inertia `version`). When a client sends a different one
   * on an Inertia visit, it gets `409` with `X-Inertia-Location` and reloads.
   * Default `''`.
   */
  version?: string | (() => string | Promise<string>);

  /** Document title for the default root view. Default: `appName`. */
  title?: string;

  /** Script URLs the default root view loads (your Vue/Inertia entry), as modules. */
  scripts?: string[];

  /** Stylesheet URLs the default root view links. */
  styles?: string[];

  /** Extra raw HTML for the default root view's `<head>`. */
  head?: string;

  /**
   * Extra props shared with every page, like your own `HandleInertiaRequests`.
   * Merged over the package's shared props.
   */
  share?: (request: any) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Looks up host users so the screens can show names. Escalated owns no users;
   * without this it shows contact names, agent display names, or `User #id`.
   */
  resolveUsers?: (ids: UserId[]) => EscalatedUiUser[] | Promise<EscalatedUiUser[]>;

  /**
   * Lists host users for `Admin/Users/Index`: one page, filtered by `search`
   * (name or email), with each user's admin and agent access. Escalated owns
   * no users; without this hook the page renders empty, with a `notice`
   * saying the host has not provided the list. escalated-laravel orders admins
   * first, then agents, then by id.
   */
  listUsers?: (query: EscalatedUiUserQuery) => EscalatedUiUserPage | Promise<EscalatedUiUserPage>;

  /**
   * Applies an admin's change to a user's Escalated admin/agent access from
   * `Admin/Users/Index`. Return `false` when there is no such user (the
   * screen answers 404). Without this hook the toggles answer with an error
   * flash and change nothing. An admin removing their own admin access is
   * refused before the hook is called.
   */
  updateUserRoles?: (
    userId: string,
    change: EscalatedUiRoleChange,
  ) => boolean | void | Promise<boolean | void>;
}

export function uiEnabled(options: { ui?: EscalatedUiOptions } | undefined | null): boolean {
  return options?.ui?.enabled === true;
}
