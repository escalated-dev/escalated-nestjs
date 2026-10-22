import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserId } from '../../config/user-id-column';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import {
  BucketBy,
  FIRST_RESPONSE_BUCKETS,
  GroupedTimes,
  periodDays,
  RESOLUTION_BUCKETS,
  ReportingService,
  TicketFact,
} from '../../services/reporting.service';
import { inertia } from '../inertia';
import { EscalatedUi } from '../inertia.interceptor';
import { iso, person } from '../serializers';
import { UiDataService } from '../ui-data.service';

/**
 * What the response-time and resolution screens measure "on target" against,
 * as escalated-laravel's ReportController states them.
 */
const FIRST_RESPONSE_TARGET_HOURS = 4;
const RESOLUTION_TARGET_HOURS = 24;

const DAY = 86_400_000;

/** Every chart on the report screens reads `{ label, value }`. */
function labelled(buckets: Array<{ bucket: string; count: number }>) {
  return buckets.map((row) => ({ label: row.bucket, value: row.count }));
}

/**
 * The admin report screens (`/escalated/admin/reports/*`), with
 * escalated-laravel's ReportController as the prop contract. `AgentDetail` is
 * not served: Laravel's own props for it do not match the component.
 */
@UseGuards(EscalatedAdminGuard)
@EscalatedUi()
@Controller('escalated/admin/reports')
export class AdminReportsUiController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly data: UiDataService,
  ) {}

  private window(days: number) {
    const end = new Date();
    return { start: new Date(end.getTime() - days * DAY), end };
  }

  /** Adds `agent_name` to rows keyed by `agent_id`, from the host's users. */
  private async named<T extends { agent_id: UserId }>(rows: T[]) {
    const directory = await this.data.directory(rows.map((row) => row.agent_id));
    return rows.map((row) => ({
      ...row,
      agent_name: person(directory, row.agent_id)?.name ?? String(row.agent_id),
    }));
  }

  /** Average hours per department name (`Unassigned` without one). */
  private async byDepartment(rows: GroupedTimes[]) {
    const names = await this.reporting.departmentNames(rows.map((row) => row.group));
    return rows.map((row) => ({ label: names.get(row.group) ?? 'Unassigned', value: row.avg }));
  }

  /** The agent table on the time screens; unassigned tickets are not an agent. */
  private agentTimes(rows: GroupedTimes[]) {
    return this.named(
      rows
        .filter((row) => row.group !== 'unknown')
        .map((row) => ({
          agent_id: row.value as UserId,
          count: row.count,
          avg: row.avg,
          median: row.median,
          p90: row.p90,
        })),
    );
  }

  @Get()
  async overview(@Query() query: Record<string, unknown>) {
    const days = periodDays(query, false);
    const { start } = this.window(days);
    const [facts, ratings, resolved, byStatus, byPriority] = await Promise.all([
      this.reporting.facts(start),
      this.reporting.ratingFacts(start),
      this.reporting.resolvedSince(start),
      this.reporting.countByStatus(start),
      this.reporting.countByPriority(start),
    ]);
    const breakdown: Record<string, number> = {};
    for (const { rating } of ratings) breakdown[rating] = (breakdown[rating] ?? 0) + 1;

    return inertia('Escalated/Admin/Reports', {
      period_days: days,
      total_tickets: facts.length,
      resolved_tickets: resolved,
      avg_first_response_hours: this.reporting.averageHours(facts, 'firstRespondedAt'),
      sla_breach_count: facts.filter((fact) => fact.breached).length,
      by_status: Object.fromEntries(byStatus.map((row) => [row.label, row.value])),
      by_priority: Object.fromEntries(byPriority.map((row) => [row.label, row.value])),
      csat: {
        average: this.reporting.csatAverage(ratings),
        total: ratings.length,
        breakdown,
      },
    });
  }

  @Get('dashboard')
  async dashboard(@Query() query: Record<string, unknown>) {
    const days = periodDays(query, false);
    const { start, end } = this.window(days);
    const [facts, ratings, byStatus, byPriority] = await Promise.all([
      this.reporting.facts(start, end),
      this.reporting.ratingFacts(start, end),
      this.reporting.countByStatus(),
      this.reporting.countByPriority(),
    ]);
    return inertia('Escalated/Admin/Reports/Dashboard', {
      period_days: days,
      volume: this.reporting.volumeByDate(facts),
      by_status: byStatus,
      by_priority: byPriority,
      avg_response_hours: this.reporting.averageHours(facts, 'firstRespondedAt'),
      avg_resolution_hours: this.reporting.averageHours(facts, 'resolvedAt'),
      sla_compliance: this.reporting.slaCompliance(facts),
      csat_average: this.reporting.csatAverage(ratings),
      agent_performance: await this.named(this.reporting.agentPerformance(facts)),
    });
  }

  @Get('agents')
  async agents(@Query() query: Record<string, unknown>) {
    const days = periodDays(query, false);
    const { start, end } = this.window(days);
    const facts = await this.reporting.facts(start, end);
    return inertia('Escalated/Admin/Reports/AgentMetrics', {
      period_days: days,
      agents: await this.named(this.reporting.agentPerformance(facts)),
    });
  }

  @Get('sla')
  async sla(@Query() query: Record<string, unknown>) {
    const days = periodDays(query, false);
    const { start, end } = this.window(days);
    const facts = await this.reporting.facts(start, end);
    const breached = await this.reporting.breachedTickets(start, end);
    const [policies, directory] = await Promise.all([
      this.reporting.policyNames([
        ...new Set(breached.map((t) => t.slaPolicyId).filter((id) => id != null)),
      ] as number[]),
      this.data.directory(breached.map((t) => t.assigneeId)),
    ]);
    return inertia('Escalated/Admin/Reports/SlaReport', {
      period_days: days,
      compliance_rate: this.reporting.slaCompliance(facts),
      compliance_by_policy: await this.reporting.complianceByPolicy(facts),
      breaches: breached.map((ticket) => {
        const policy = ticket.slaPolicyId != null ? policies.get(ticket.slaPolicyId) : null;
        const assignee = person(directory, ticket.assigneeId);
        return {
          id: ticket.id,
          reference: ticket.referenceNumber,
          subject: ticket.subject,
          assigned_to: ticket.assigneeId ?? null,
          sla_policy_id: ticket.slaPolicyId ?? null,
          sla_first_response_breached: ticket.slaFirstResponseBreached === true,
          sla_resolution_breached: ticket.slaResolutionBreached === true,
          first_response_at: iso(ticket.firstRespondedAt),
          resolved_at: iso(ticket.resolvedAt),
          created_at: iso(ticket.createdAt),
          assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
          sla_policy: policy ? { id: policy.id, name: policy.name } : null,
        };
      }),
    });
  }

  @Get('csat')
  async csat(@Query() query: Record<string, unknown>) {
    const days = periodDays(query, false);
    const { start, end } = this.window(days);
    const [facts, ratings] = await Promise.all([
      this.reporting.facts(start, end),
      this.reporting.ratingFacts(start, end),
    ]);
    return inertia('Escalated/Admin/Reports/CsatReport', {
      period_days: days,
      csat_average: this.reporting.csatAverage(ratings),
      response_rate: facts.length ? Math.round((ratings.length / facts.length) * 1000) / 10 : 0,
      total_ratings: ratings.length,
      by_agent: await this.named(this.reporting.csatByAgent(ratings)),
      over_time: this.reporting.csatOverTime(ratings),
    });
  }

  @Get('sla-trends')
  async slaTrends(@Query() query: Record<string, unknown>) {
    const days = periodDays(query);
    const groupBy: BucketBy = ['week', 'month'].includes(String(query?.group_by))
      ? (String(query.group_by) as BucketBy)
      : 'day';
    const { start } = this.window(days);
    const facts = await this.reporting.facts(start);
    const counts = this.reporting.breachCounts(facts);
    const trends = this.reporting.breachTrends(facts, groupBy);
    const departments = await this.reporting.departmentNames(
      facts.map((fact) => fact.departmentId ?? 'unknown'),
    );

    return inertia('Escalated/Admin/Reports/SlaTrends', {
      period_days: days,
      breach_trend: trends.total,
      breach_by_type_trend: trends.by_type,
      breach_by_department: this.reporting
        .breachBy(facts, (fact) => departments.get(String(fact.departmentId)) ?? 'Unassigned')
        .map((row) => ({ label: row.name, value: row.breach_rate })),
      breach_by_priority: this.reporting
        .breachBy(facts, (fact) => fact.priority || 'unknown')
        .map((row) => ({ label: row.name, value: row.breach_rate })),
      at_risk_tickets: await this.reporting.atRiskTickets(),
      total_breaches: counts.total,
      breach_rate: counts.rate,
      first_response_breaches: counts.first_response,
      resolution_breaches: counts.resolution,
    });
  }

  @Get(['response-times', 'frt'])
  async responseTimes(@Query() query: Record<string, unknown>) {
    const days = periodDays(query);
    const facts = await this.reporting.facts(this.window(days).start);
    const summary = this.reporting.summary(facts, 'firstRespondedAt', FIRST_RESPONSE_TARGET_HOURS);
    const label = (rows: GroupedTimes[]) =>
      rows.map((row) => ({ label: row.group, value: row.avg }));

    return inertia('Escalated/Admin/Reports/ResponseTimes', {
      period_days: days,
      avg_frt: summary.avg,
      median_frt: summary.median,
      p90_frt: summary.p90,
      pct_under_target: summary.pct_under_target,
      target_hours: FIRST_RESPONSE_TARGET_HOURS,
      distribution: labelled(
        this.reporting.histogram(facts, 'firstRespondedAt', FIRST_RESPONSE_BUCKETS),
      ),
      trend: this.reporting.trend(facts, 'firstRespondedAt'),
      by_agent: await this.agentTimes(
        this.reporting.timesBy(facts, 'firstRespondedAt', (f) => f.assigneeId),
      ),
      by_department: await this.byDepartment(
        this.reporting.timesBy(facts, 'firstRespondedAt', (f) => f.departmentId),
      ),
      by_priority: label(this.reporting.timesBy(facts, 'firstRespondedAt', (f) => f.priority)),
    });
  }

  @Get(['resolution-times', 'resolution'])
  async resolutionTimes(@Query() query: Record<string, unknown>) {
    const days = periodDays(query);
    const facts = await this.reporting.facts(this.window(days).start);
    const summary = this.reporting.summary(facts, 'resolvedAt', RESOLUTION_TARGET_HOURS);

    return inertia('Escalated/Admin/Reports/ResolutionTimes', {
      period_days: days,
      avg_resolution: summary.avg,
      median_resolution: summary.median,
      p90_resolution: summary.p90,
      pct_under_target: summary.pct_under_target,
      target_hours: RESOLUTION_TARGET_HOURS,
      distribution: labelled(this.reporting.histogram(facts, 'resolvedAt', RESOLUTION_BUCKETS)),
      trend: this.reporting.trend(facts, 'resolvedAt'),
      by_agent: await this.agentTimes(
        this.reporting.timesBy(facts, 'resolvedAt', (f) => f.assigneeId),
      ),
      by_department: await this.byDepartment(
        this.reporting.timesBy(facts, 'resolvedAt', (f) => f.departmentId),
      ),
      by_channel: this.reporting
        .timesBy(facts, 'resolvedAt', (f) => f.channel)
        .map((row) => ({ label: row.group, value: row.avg })),
    });
  }

  @Get('agent-ranking')
  async agentRanking(@Query() query: Record<string, unknown>) {
    const days = periodDays(query);
    const { start, end } = this.window(days);
    const [facts, ratings] = await Promise.all([
      this.reporting.facts(start, end),
      this.reporting.ratingFacts(start),
    ]);
    return inertia('Escalated/Admin/Reports/AgentRanking', {
      period_days: days,
      agents: (await this.named(this.reporting.agentRanking(facts, ratings))).map((agent) => ({
        agent_id: agent.agent_id,
        agent_name: agent.agent_name,
        volume: agent.total_tickets,
        resolution_rate: agent.resolution_rate,
        avg_frt: agent.avg_response_hours,
        avg_resolution: agent.avg_resolution_hours,
        csat: agent.csat_average,
        composite_score: agent.composite_score,
      })),
    });
  }

  @Get('cohorts')
  async cohorts(@Query() query: Record<string, unknown>) {
    const days = periodDays(query);
    const { start } = this.window(days);
    const [facts, ratings] = await Promise.all([
      this.reporting.facts(start),
      this.reporting.ratingFacts(start),
    ]);
    const departments = await this.reporting.departmentNames(
      facts.map((fact) => fact.departmentId ?? 'unknown'),
    );
    const table = (groups: Map<string, TicketFact[]>) =>
      this.reporting.cohorts(groups, ratings).map((row) => ({
        name: row.name,
        volume: row.volume,
        avg_resolution: row.avg_resolution_hours,
        breach_rate: row.breach_rate,
        csat: row.csat,
      }));
    const by = (key: (fact: TicketFact) => string) => this.reporting.cohortsBy(facts, key);

    return inertia('Escalated/Admin/Reports/Cohorts', {
      period_days: days,
      by_tag: table(await this.reporting.tagCohorts(facts)),
      by_department: table(
        by((fact) => departments.get(String(fact.departmentId)) ?? 'Unassigned'),
      ),
      by_channel: table(by((fact) => fact.channel || 'unknown')),
      by_type: table(by((fact) => fact.ticketType || 'unspecified')),
      by_priority: table(by((fact) => fact.priority || 'unspecified')),
    });
  }

  @Get('comparison')
  async comparison(@Query() query: Record<string, unknown>) {
    const days = periodDays(query);
    const now = new Date();
    const currentStart = new Date(now.getTime() - days * DAY);
    const previousStart = new Date(now.getTime() - 2 * days * DAY);

    const side = async (start: Date, end: Date) => {
      const [facts, ratings] = await Promise.all([
        this.reporting.facts(start, end),
        this.reporting.ratingFacts(start, end),
      ]);
      return {
        total_tickets: facts.length,
        resolved_tickets: facts.filter((fact) => fact.resolvedAt != null).length,
        avg_frt: this.reporting.averageHours(facts, 'firstRespondedAt'),
        avg_resolution: this.reporting.averageHours(facts, 'resolvedAt'),
        sla_compliance: this.reporting.slaCompliance(facts),
        csat: this.reporting.csatAverage(ratings),
        breach_count: facts.filter((fact) => fact.breached).length,
        volume_trend: this.reporting.volumeByDate(facts),
      };
    };

    return inertia('Escalated/Admin/Reports/Comparison', {
      period_days: days,
      current: await side(currentStart, now),
      previous: await side(previousStart, currentStart),
    });
  }
}
