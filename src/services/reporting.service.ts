import { Injectable } from '@nestjs/common';
import { NOT_SOLVED_STATUS_PARAMS, notSolvedStatusSql } from '../entities/status-category';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { UserId } from '../config/user-id-column';
import { Department } from '../entities/department.entity';
import { SatisfactionRating } from '../entities/satisfaction-rating.entity';
import { SlaPolicy } from '../entities/sla-policy.entity';
import { Ticket } from '../entities/ticket.entity';

/**
 * Reporting figures, as escalated-laravel's ReportingService computes them.
 *
 * Tickets and ratings are selected and grouped in SQL that every supported
 * database runs the same way (plain comparisons, COUNT and GROUP BY). Times
 * between two timestamps and calendar buckets are worked out here from the
 * selected rows instead of with each database's own date functions, so a
 * figure is the same on PostgreSQL, MySQL and SQLite (MySQL's TIMESTAMPDIFF,
 * which Laravel uses there, truncates to whole hours).
 *
 * Dates are bucketed in UTC. Agent rows carry `agent_id`; names are added by
 * the caller, which knows the host's users.
 */

/** What the reports need of a ticket. */
export interface TicketFact {
  id: number;
  createdAt: Date;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  assigneeId: UserId | null;
  departmentId: number | null;
  priority: string | null;
  channel: string | null;
  ticketType: string | null;
  slaPolicyId: number | null;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  /** Either deadline missed (Laravel's breachedSla scope). */
  breached: boolean;
}

export interface LabelValue {
  label: string;
  value: number;
}

export interface AgentPerformanceRow {
  agent_id: UserId;
  total_tickets: number;
  resolved_tickets: number;
  avg_response_hours: number | null;
  avg_resolution_hours: number | null;
}

export interface TimeSummary {
  avg: number;
  median: number;
  p90: number;
  pct_under_target: number;
}

export interface GroupedTimes {
  group: string;
  /** The grouped value as stored (`group` is its text, `unknown` when empty). */
  value: unknown;
  count: number;
  avg: number;
  median: number;
  p90: number;
}

export interface CohortRow {
  name: string;
  volume: number;
  resolved: number;
  avg_resolution_hours: number;
  breached: number;
  breach_rate: number;
  csat: number;
}

export type TimeColumn = 'firstRespondedAt' | 'resolvedAt';
export type BucketBy = 'day' | 'week' | 'month';

const HOUR = 3_600_000;

export const FIRST_RESPONSE_BUCKETS: Array<[string, number, number | null]> = [
  ['<1h', 0, 1],
  ['1-4h', 1, 4],
  ['4-8h', 4, 8],
  ['8-24h', 8, 24],
  ['>24h', 24, null],
];

export const RESOLUTION_BUCKETS: Array<[string, number, number | null]> = [
  ['<4h', 0, 4],
  ['4-8h', 4, 8],
  ['8-24h', 8, 24],
  ['1-3d', 24, 72],
  ['3-7d', 72, 168],
  ['>7d', 168, null],
];

/** Rounded to one decimal place, as the reports show figures. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

/** Linear interpolation between the closest ranks, as Laravel's ReportingService. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (index - lower) * (sorted[upper] - sorted[lower]);
}

function hoursBetween(from: Date, to: Date): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / HOUR;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The calendar bucket of a date, in UTC: `2026-10-21`, `2026-W43` (ISO week) or `2026-10`. */
export function bucketOf(date: Date, by: BucketBy = 'day'): string {
  const d = new Date(date);
  if (by === 'month') return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  if (by === 'week') {
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - weekday);
    const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${day.getUTCFullYear()}-W${pad(week)}`;
  }
  return d.toISOString().slice(0, 10);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(row);
  }
  return groups;
}

function sortedKeys<T>(groups: Map<string, T>): string[] {
  return [...groups.keys()].sort();
}

function rate(part: number, total: number): number {
  return total > 0 ? round1((part / total) * 100) : 0;
}

/**
 * The report period in days: `period`, else `days` (the screens' period
 * selector), else 30, as escalated-laravel reads it.
 */
export function periodDays(query: Record<string, unknown>, preferPeriod = true): number {
  const read = (value: unknown) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const days = (preferPeriod ? read(query?.period) : null) ?? read(query?.days) ?? 30;
  return Math.min(Math.max(days, 1), 3650);
}

@Injectable()
export class ReportingService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(SatisfactionRating)
    private readonly ratings: Repository<SatisfactionRating>,
    @InjectRepository(SlaPolicy) private readonly policies: Repository<SlaPolicy>,
    @InjectRepository(Department) private readonly departments: Repository<Department>,
  ) {}

  // Selection

  private ticketQuery(start: Date, end?: Date): SelectQueryBuilder<Ticket> {
    const qb = this.tickets
      .createQueryBuilder('ticket')
      .select([
        'ticket.id',
        'ticket.createdAt',
        'ticket.firstRespondedAt',
        'ticket.resolvedAt',
        'ticket.assigneeId',
        'ticket.departmentId',
        'ticket.priority',
        'ticket.channel',
        'ticket.ticketType',
        'ticket.slaPolicyId',
        'ticket.slaBreached',
        'ticket.slaFirstResponseBreached',
        'ticket.slaResolutionBreached',
      ])
      .where('ticket.createdAt >= :start', { start });
    if (end) qb.andWhere('ticket.createdAt <= :end', { end });
    return qb;
  }

  private toFact(ticket: Ticket): TicketFact {
    const firstResponseBreached = ticket.slaFirstResponseBreached === true;
    const resolutionBreached = ticket.slaResolutionBreached === true;
    return {
      id: ticket.id,
      createdAt: ticket.createdAt,
      firstRespondedAt: ticket.firstRespondedAt ?? null,
      resolvedAt: ticket.resolvedAt ?? null,
      assigneeId: ticket.assigneeId ?? null,
      departmentId: ticket.departmentId ?? null,
      priority: ticket.priority ?? null,
      channel: ticket.channel ?? null,
      ticketType: ticket.ticketType ?? null,
      slaPolicyId: ticket.slaPolicyId ?? null,
      firstResponseBreached,
      resolutionBreached,
      breached: firstResponseBreached || resolutionBreached || ticket.slaBreached === true,
    };
  }

  /** Tickets created since `start` (and up to `end`). */
  async facts(start: Date, end?: Date): Promise<TicketFact[]> {
    const rows = await this.ticketQuery(start, end).getMany();
    return rows.map((ticket) => this.toFact(ticket));
  }

  /** Ratings left since `start` (and up to `end`), with the rated ticket's assignee. */
  async ratingFacts(
    start: Date,
    end?: Date,
  ): Promise<
    Array<{ rating: number; createdAt: Date; ticketId: number; assigneeId: UserId | null }>
  > {
    const qb = this.ratings
      .createQueryBuilder('rating')
      .leftJoin('rating.ticket', 'ticket')
      .select(['rating.id', 'rating.rating', 'rating.createdAt', 'rating.ticketId'])
      .addSelect(['ticket.id', 'ticket.assigneeId'])
      .where('rating.createdAt >= :start', { start });
    if (end) qb.andWhere('rating.createdAt <= :end', { end });
    const rows = await qb.getMany();
    return rows.map((row) => ({
      rating: Number(row.rating),
      createdAt: row.createdAt,
      ticketId: row.ticketId,
      assigneeId: row.ticket?.assigneeId ?? null,
    }));
  }

  // Building blocks

  hours(facts: TicketFact[], column: TimeColumn): number[] {
    return facts
      .filter((fact) => fact[column] != null)
      .map((fact) => hoursBetween(fact.createdAt, fact[column]!))
      .sort((a, b) => a - b);
  }

  averageHours(facts: TicketFact[], column: TimeColumn): number {
    return round1(average(this.hours(facts, column)) ?? 0);
  }

  summary(facts: TicketFact[], column: TimeColumn, targetHours: number): TimeSummary {
    const hours = this.hours(facts, column);
    if (!hours.length) return { avg: 0, median: 0, p90: 0, pct_under_target: 0 };
    return {
      avg: round1(average(hours)!),
      median: round1(percentile(hours, 50)),
      p90: round1(percentile(hours, 90)),
      pct_under_target: rate(hours.filter((h) => h <= targetHours).length, hours.length),
    };
  }

  /** Counts and shares per bucket of hours (`{ bucket, count, percentage }`). */
  histogram(
    facts: TicketFact[],
    column: TimeColumn,
    buckets: Array<[string, number, number | null]>,
  ): Array<{ bucket: string; count: number; percentage: number }> {
    const hours = this.hours(facts, column);
    return buckets.map(([bucket, min, max]) => {
      const count = hours.filter((h) => h >= min && (max === null || h < max)).length;
      return { bucket, count, percentage: rate(count, hours.length) };
    });
  }

  /** Average hours per day the tickets were created. */
  trend(facts: TicketFact[], column: TimeColumn): LabelValue[] {
    const groups = groupBy(
      facts.filter((fact) => fact[column] != null),
      (fact) => bucketOf(fact.createdAt),
    );
    return sortedKeys(groups).map((day) => ({
      label: day,
      value: round1(average(this.hours(groups.get(day)!, column)) ?? 0),
    }));
  }

  /** Count, average, median and 90th percentile hours per value of `key` (`unknown` when empty). */
  timesBy(
    facts: TicketFact[],
    column: TimeColumn,
    key: (fact: TicketFact) => unknown,
  ): GroupedTimes[] {
    const groups = groupBy(
      facts.filter((fact) => fact[column] != null),
      (fact) => {
        const value = key(fact);
        return value == null || value === '' ? 'unknown' : String(value);
      },
    );
    return [...groups.entries()].map(([group, rows]) => {
      const hours = this.hours(rows, column);
      return {
        group,
        value: key(rows[0]) ?? null,
        count: hours.length,
        avg: round1(average(hours)!),
        median: round1(percentile(hours, 50)),
        p90: round1(percentile(hours, 90)),
      };
    });
  }

  volumeByDate(facts: TicketFact[]): LabelValue[] {
    const groups = groupBy(facts, (fact) => bucketOf(fact.createdAt));
    return sortedKeys(groups).map((day) => ({ label: day, value: groups.get(day)!.length }));
  }

  /** Share of tickets on an SLA policy that missed neither deadline; 100 with none. */
  slaCompliance(facts: TicketFact[]): number {
    const covered = facts.filter((fact) => fact.slaPolicyId != null);
    if (!covered.length) return 100;
    return round1(
      ((covered.length - covered.filter((f) => f.breached).length) / covered.length) * 100,
    );
  }

  csatAverage(ratings: Array<{ rating: number }>): number {
    return round1(average(ratings.map((r) => r.rating)) ?? 0);
  }

  agentPerformance(facts: TicketFact[]): AgentPerformanceRow[] {
    const groups = groupBy(
      facts.filter((fact) => fact.assigneeId != null && fact.assigneeId !== ''),
      (fact) => String(fact.assigneeId),
    );
    return [...groups.values()].map((rows) => {
      const response = average(this.hours(rows, 'firstRespondedAt'));
      const resolution = average(this.hours(rows, 'resolvedAt'));
      return {
        agent_id: rows[0].assigneeId!,
        total_tickets: rows.length,
        resolved_tickets: rows.filter((fact) => fact.resolvedAt != null).length,
        avg_response_hours: response === null ? null : round1(response),
        avg_resolution_hours: resolution === null ? null : round1(resolution),
      };
    });
  }

  /**
   * Agents ranked by a composite score: resolution rate (30%), first response
   * (25%), CSAT (25%) and volume (20%), as escalated-laravel's
   * agentPerformanceRanking scores them.
   */
  agentRanking(facts: TicketFact[], ratings: Array<{ rating: number; assigneeId: UserId | null }>) {
    return this.agentPerformance(facts)
      .map((agent) => {
        const resolutionRate = agent.total_tickets
          ? (agent.resolved_tickets / agent.total_tickets) * 100
          : 0;
        const avgResponse = agent.avg_response_hours ?? 0;
        const csat =
          average(
            ratings
              .filter((r) => String(r.assigneeId) === String(agent.agent_id))
              .map((r) => r.rating),
          ) ?? 0;
        const frtScore = avgResponse > 0 ? Math.max(0, 100 - avgResponse * 5) : 50;
        return {
          agent_id: agent.agent_id,
          total_tickets: agent.total_tickets,
          resolved_tickets: agent.resolved_tickets,
          resolution_rate: round1(resolutionRate),
          avg_response_hours: avgResponse,
          avg_resolution_hours: agent.avg_resolution_hours ?? 0,
          csat_average: round1(csat),
          composite_score: round1(
            resolutionRate * 0.3 +
              frtScore * 0.25 +
              csat * 20 * 0.25 +
              Math.min(100, agent.total_tickets * 2) * 0.2,
          ),
        };
      })
      .sort((a, b) => b.composite_score - a.composite_score)
      .map((agent, index) => ({ ...agent, rank: index + 1 }));
  }

  /** Average rating and count per agent the rated tickets are assigned to. */
  csatByAgent(ratings: Array<{ rating: number; assigneeId: UserId | null }>) {
    const groups = groupBy(
      ratings.filter((r) => r.assigneeId != null && r.assigneeId !== ''),
      (r) => String(r.assigneeId),
    );
    return [...groups.values()].map((rows) => ({
      agent_id: rows[0].assigneeId as UserId,
      avg_rating: this.csatAverage(rows),
      total_ratings: rows.length,
    }));
  }

  /** Average rating per day. */
  csatOverTime(ratings: Array<{ rating: number; createdAt: Date }>): LabelValue[] {
    const groups = groupBy(ratings, (r) => bucketOf(r.createdAt));
    return sortedKeys(groups).map((day) => ({
      label: day,
      value: this.csatAverage(groups.get(day)!),
    }));
  }

  /** Tickets on an SLA policy, breached and the breach rate, per value of `key`. */
  breachBy(facts: TicketFact[], key: (fact: TicketFact) => string) {
    const groups = groupBy(
      facts.filter((fact) => fact.slaPolicyId != null),
      key,
    );
    return [...groups.entries()].map(([name, rows]) => {
      const breached = rows.filter((f) => f.breached).length;
      return { name, total: rows.length, breached, breach_rate: rate(breached, rows.length) };
    });
  }

  breachTrends(facts: TicketFact[], by: BucketBy) {
    const groups = groupBy(
      facts.filter((fact) => fact.breached),
      (fact) => bucketOf(fact.createdAt, by),
    );
    const rows = sortedKeys(groups).map((period) => {
      const breaches = groups.get(period)!;
      return {
        period,
        first: breaches.filter((f) => f.firstResponseBreached).length,
        resolution: breaches.filter((f) => f.resolutionBreached).length,
        total: breaches.length,
      };
    });
    return {
      total: rows.map((row) => ({ label: row.period, value: row.total })),
      by_type: rows.map((row) => ({ label: row.period, values: [row.first, row.resolution] })),
    };
  }

  breachCounts(facts: TicketFact[]) {
    const breached = facts.filter((f) => f.breached).length;
    return {
      total: breached,
      rate: rate(breached, facts.length),
      first_response: facts.filter((f) => f.firstResponseBreached).length,
      resolution: facts.filter((f) => f.resolutionBreached).length,
    };
  }

  /** Volume, resolution time, breach rate and CSAT per cohort. */
  cohorts(
    groups: Map<string, TicketFact[]>,
    ratings: Array<{ rating: number; ticketId: number }>,
  ): CohortRow[] {
    const byTicket = groupBy(ratings, (r) => String(r.ticketId));
    return [...groups.entries()].map(([name, rows]) => {
      const breached = rows.filter((f) => f.breached).length;
      const rated = rows.flatMap((f) => byTicket.get(String(f.id)) ?? []);
      return {
        name,
        volume: rows.length,
        resolved: rows.filter((f) => f.resolvedAt != null).length,
        avg_resolution_hours: this.averageHours(rows, 'resolvedAt'),
        breached,
        breach_rate: rate(breached, rows.length),
        csat: this.csatAverage(rated),
      };
    });
  }

  cohortsBy(facts: TicketFact[], key: (fact: TicketFact) => string) {
    return groupBy(facts, key);
  }

  /** Tag names of the given tickets, grouped by tag (a ticket counts under each of its tags). */
  async tagCohorts(facts: TicketFact[]): Promise<Map<string, TicketFact[]>> {
    const groups = new Map<string, TicketFact[]>();
    const byId = new Map(facts.map((fact) => [fact.id, fact]));
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const tickets = await this.tickets
        .createQueryBuilder('ticket')
        .innerJoin('ticket.tags', 'tag')
        .select(['ticket.id'])
        .addSelect(['tag.id', 'tag.name'])
        .where('ticket.id IN (:...ids)', { ids: ids.slice(i, i + 500) })
        .getMany();
      for (const ticket of tickets) {
        for (const tag of ticket.tags ?? []) {
          if (!groups.has(tag.name)) groups.set(tag.name, []);
          groups.get(tag.name)!.push(byId.get(ticket.id)!);
        }
      }
    }
    return groups;
  }

  // Whole-table and lookup queries

  /** Ticket counts per status slug, over every ticket. */
  async countByStatus(start?: Date): Promise<LabelValue[]> {
    const qb = this.tickets
      .createQueryBuilder('ticket')
      .leftJoin('ticket.status', 'status')
      .select('status.slug', 'label')
      .addSelect('COUNT(ticket.id)', 'value')
      .groupBy('status.slug');
    if (start) qb.where('ticket.createdAt >= :start', { start });
    const rows = await qb.getRawMany();
    return rows.map((row) => ({ label: row.label ?? 'unknown', value: Number(row.value) }));
  }

  /** Ticket counts per priority, over every ticket. */
  async countByPriority(start?: Date): Promise<LabelValue[]> {
    const qb = this.tickets
      .createQueryBuilder('ticket')
      .select('ticket.priority', 'label')
      .addSelect('COUNT(ticket.id)', 'value')
      .groupBy('ticket.priority');
    if (start) qb.where('ticket.createdAt >= :start', { start });
    const rows = await qb.getRawMany();
    return rows.map((row) => ({ label: row.label ?? 'unknown', value: Number(row.value) }));
  }

  async resolvedSince(start: Date): Promise<number> {
    return this.tickets
      .createQueryBuilder('ticket')
      .where('ticket.resolvedAt IS NOT NULL')
      .andWhere('ticket.resolvedAt >= :start', { start })
      .getCount();
  }

  /** Compliance per active policy: `{ policy_name, total, met, breached }`. */
  async complianceByPolicy(facts: TicketFact[]) {
    const policies = await this.policies.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' } as any,
    });
    return policies.map((policy) => {
      const rows = facts.filter((f) => f.slaPolicyId === policy.id);
      const breached = rows.filter((f) => f.breached).length;
      return {
        policy_name: policy.name,
        total: rows.length,
        met: rows.length - breached,
        breached,
      };
    });
  }

  /** The newest 100 breached tickets created in the window. */
  async breachedTickets(start: Date, end: Date): Promise<Ticket[]> {
    return this.tickets
      .createQueryBuilder('ticket')
      .where('ticket.createdAt BETWEEN :start AND :end', { start, end })
      .andWhere(
        new Brackets((q) =>
          q
            .where('ticket.slaFirstResponseBreached = :yes', { yes: true })
            .orWhere('ticket.slaResolutionBreached = :yes')
            .orWhere('ticket.slaBreached = :yes'),
        ),
      )
      .orderBy('ticket.createdAt', 'DESC')
      .addOrderBy('ticket.id', 'DESC')
      .take(100)
      .getMany();
  }

  async policyNames(ids: number[]): Promise<Map<number, SlaPolicy>> {
    if (!ids.length) return new Map();
    const rows = await this.policies.findBy({ id: In(ids) });
    return new Map(rows.map((policy) => [policy.id, policy]));
  }

  async departmentNames(ids: Array<number | string>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id) => id != null && id !== 'unknown').map(Number))];
    if (!wanted.length) return new Map();
    const rows = await this.departments.findBy({ id: In(wanted) });
    return new Map(rows.map((d) => [String(d.id), d.name]));
  }

  /**
   * Open tickets whose next SLA deadline falls within `withinHours`, soonest
   * first: `{ id, reference, subject, hours_remaining }`.
   */
  async atRiskTickets(withinHours = 8, limit = 50, now = new Date()) {
    const deadline = new Date(now.getTime() + withinHours * HOUR);
    const rows = await this.tickets
      .createQueryBuilder('ticket')
      .leftJoin('ticket.status', 'status')
      .select([
        'ticket.id',
        'ticket.referenceNumber',
        'ticket.subject',
        'ticket.firstRespondedAt',
        'ticket.firstResponseDueAt',
        'ticket.resolutionDueAt',
        'ticket.resolvedAt',
      ])
      .where('ticket.isMerged = :merged', { merged: false })
      .andWhere(
        new Brackets((open) =>
          open
            .where('ticket.statusId IS NULL')
            .orWhere(
              new Brackets((s) => s.where(notSolvedStatusSql('status'), NOT_SOLVED_STATUS_PARAMS)),
            ),
        ),
      )
      .andWhere(
        new Brackets((due) =>
          due
            .where(
              new Brackets((frt) =>
                frt
                  .where('ticket.firstRespondedAt IS NULL')
                  .andWhere('ticket.slaFirstResponseBreached = :no', { no: false })
                  .andWhere('ticket.firstResponseDueAt BETWEEN :now AND :deadline', {
                    now,
                    deadline,
                  }),
              ),
            )
            .orWhere(
              new Brackets((res) =>
                res
                  .where('ticket.resolvedAt IS NULL')
                  .andWhere('ticket.slaResolutionBreached = :no')
                  .andWhere('ticket.resolutionDueAt BETWEEN :now AND :deadline'),
              ),
            ),
        ),
      )
      .getMany();

    const within = (at: Date | null) => {
      if (!at) return null;
      const time = new Date(at).getTime();
      return time >= now.getTime() && time <= deadline.getTime() ? time : null;
    };
    return rows
      .map((ticket) => {
        const times = [
          ticket.firstRespondedAt == null ? within(ticket.firstResponseDueAt) : null,
          ticket.resolvedAt == null ? within(ticket.resolutionDueAt) : null,
        ].filter((t): t is number => t !== null);
        const due = Math.min(...times);
        return {
          id: ticket.id,
          reference: ticket.referenceNumber,
          subject: ticket.subject,
          hours_remaining: round1(Math.floor((due - now.getTime()) / 60_000) / 60),
        };
      })
      .sort((a, b) => a.hours_remaining - b.hours_remaining)
      .slice(0, limit);
  }
}
