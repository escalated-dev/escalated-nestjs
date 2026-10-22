/**
 * Status categories, as escalated-laravel names them. Every ticket status
 * belongs to one, and ticket lifecycle keys off it: a `solved` status stamps
 * `resolvedAt`/`closedAt`, stops SLA and escalation, counts as closed in
 * reports and queues, and decides whether a customer or guest may reply,
 * rate or reopen. The other four are open.
 */
export const STATUS_CATEGORIES = ['new', 'open', 'pending', 'on_hold', 'solved'] as const;

export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/**
 * The built-in status slugs (escalated-laravel's `TicketStatus` enum plus
 * `snoozed`). A row with one of these slugs is a system status: its slug and
 * category are fixed and it cannot be deleted.
 */
export const SYSTEM_STATUS_SLUGS = [
  'open',
  'in_progress',
  'waiting_on_customer',
  'waiting_on_agent',
  'escalated',
  'resolved',
  'closed',
  'reopened',
  'live',
  'snoozed',
];

/** Slugs that always close a ticket, whatever the row says. */
export const TERMINAL_STATUS_SLUGS = ['resolved', 'closed'];

interface StatusLike {
  slug?: string | null;
  category?: string | null;
  isClosed?: boolean | null;
}

export function isStatusCategory(value: unknown): value is StatusCategory {
  return typeof value === 'string' && (STATUS_CATEGORIES as readonly string[]).includes(value);
}

/** The category a row without one takes: from its closed flag and slug. */
export function inferredCategory(slug: string | null | undefined, isClosed?: boolean | null) {
  if (isClosed || TERMINAL_STATUS_SLUGS.includes(slug ?? '')) return 'solved';
  if (slug === 'waiting_on_customer' || slug === 'pending') return 'pending';
  if (slug === 'snoozed') return 'on_hold';
  return 'open';
}

/**
 * A status's category. `isClosed` is kept equal to `category === 'solved'`;
 * a row whose `isClosed` is true, or whose slug is `resolved`/`closed`,
 * counts as solved either way, and a row without a category (written
 * before the column existed, or by host code that does not set it) takes
 * the one its flag and slug imply.
 */
export function statusCategory(status: StatusLike | null | undefined): StatusCategory {
  if (!status) return 'open';
  if (status.isClosed || TERMINAL_STATUS_SLUGS.includes(status.slug ?? '')) return 'solved';
  if (isStatusCategory(status.category)) return status.category;
  return inferredCategory(status.slug, status.isClosed);
}

/** A status in the `solved` category closes the ticket. */
export function isSolvedStatus(status: StatusLike | null | undefined): boolean {
  return !!status && statusCategory(status) === 'solved';
}

/**
 * SQL for "this status is not solved", for a query that joins the status as
 * `alias`. Matches `isSolvedStatus`; pair it with `<ticket>.statusId IS NULL`
 * for tickets with no status at all.
 */
export function notSolvedStatusSql(alias: string): string {
  return (
    `(${alias}.isClosed = :__notClosed` +
    ` AND (${alias}.category IS NULL OR ${alias}.category <> :__solvedCategory)` +
    ` AND ${alias}.slug NOT IN (:...__terminalSlugs))`
  );
}

/** The parameters `notSolvedStatusSql` binds. */
export const NOT_SOLVED_STATUS_PARAMS = {
  __notClosed: false,
  __solvedCategory: 'solved',
  __terminalSlugs: TERMINAL_STATUS_SLUGS,
};

/**
 * The status new tickets get: the default status, as before. Defaults are
 * exclusive per category, so when several categories have one the earliest
 * category wins (`new`, then `open`, ...), then position, then id.
 */
export function pickDefaultStatus<
  T extends StatusLike & { isDefault?: boolean; sortOrder?: number; id?: number },
>(rows: T[]): T | null {
  const defaults = rows.filter((row) => row.isDefault);
  defaults.sort(
    (a, b) =>
      STATUS_CATEGORIES.indexOf(statusCategory(a)) - STATUS_CATEGORIES.indexOf(statusCategory(b)) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      (a.id ?? 0) - (b.id ?? 0),
  );
  return defaults[0] ?? null;
}
