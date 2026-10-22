import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { AuditLogService } from '../../services/audit-log.service';
import {
  FIRST_RESPONSE_BUCKETS,
  periodDays,
  RESOLUTION_BUCKETS,
  ReportingService,
} from '../../services/reporting.service';
import { person } from '../../ui/serializers';
import { UiDataService } from '../../ui/ui-data.service';

/** The report types escalated-laravel's ReportExportService exports. */
export const REPORT_EXPORT_TYPES = [
  'tickets',
  'agent_performance',
  'sla_compliance',
  'csat',
  'resolution_times',
  'first_response_times',
] as const;

type Row = Record<string, unknown>;

/**
 * A CSV cell. Text a spreadsheet would read as a formula (`=`, `+`, `-`, `@`,
 * tab, carriage return) is prefixed with `'`; nested values are JSON.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Row[]): string {
  if (!rows.length) return 'No data available\n';
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    [
      columns.map(csvCell).join(','),
      ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(',')),
    ].join('\n') + '\n'
  );
}

/**
 * `GET /escalated/admin/reports/export/:type?format=csv|json&period=30`, as
 * escalated-laravel's ReportController::export: the report's rows as a CSV
 * download, or as JSON for BI tools. Each export is recorded in the audit log.
 */
@UseGuards(EscalatedAdminGuard)
@Controller('escalated/admin/reports/export')
export class AdminReportExportController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly data: UiDataService,
    private readonly audit: AuditLogService,
  ) {}

  @Get(':type')
  async export(
    @Param('type') type: string,
    @Query() query: Record<string, unknown>,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    if (!(REPORT_EXPORT_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(
        `Unsupported report type: ${type}. Supported types: ${REPORT_EXPORT_TYPES.join(', ')}`,
      );
    }
    const format = query?.format === 'json' ? 'json' : 'csv';
    const period = periodDays(query);
    const rows = await this.rows(type, period);

    await this.audit.log({
      userId: req?.user?.id ?? null,
      action: 'report.exported',
      entityType: 'ticket',
      entityId: 0,
      newValues: { type, format, period },
    });

    if (format === 'json') {
      return {
        report_type: type,
        generated_at: new Date().toISOString(),
        filters: { period },
        record_count: rows.length,
        data: rows,
      };
    }
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_report_${stamp}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return toCsv(rows);
  }

  private async named(rows: Row[]): Promise<Row[]> {
    const directory = await this.data.directory(rows.map((row) => row.agent_id as any));
    return rows.map((row) => ({
      ...row,
      agent_name: person(directory, row.agent_id as any)?.name ?? String(row.agent_id),
    }));
  }

  private async rows(type: string, days: number): Promise<Row[]> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const tag = (metric: string) => (row: object) => ({ ...row, metric });

    switch (type) {
      case 'tickets': {
        const facts = await this.reporting.facts(start, end);
        return [
          ...this.reporting.volumeByDate(facts).map(tag('daily_volume')),
          ...(await this.reporting.countByStatus()).map(tag('by_status')),
          ...(await this.reporting.countByPriority()).map(tag('by_priority')),
        ];
      }
      case 'agent_performance': {
        const [facts, ratings] = await Promise.all([
          this.reporting.facts(start, end),
          this.reporting.ratingFacts(start),
        ]);
        return this.named(this.reporting.agentRanking(facts, ratings));
      }
      case 'sla_compliance': {
        const facts = await this.reporting.facts(start, end);
        const departments = await this.reporting.departmentNames(
          facts.map((fact) => fact.departmentId ?? 'unknown'),
        );
        const breach = (key: string, rows: ReturnType<ReportingService['breachBy']>) =>
          rows.map(({ name, ...row }) => ({ [key]: name, ...row }));
        return [
          ...(await this.reporting.complianceByPolicy(facts)).map(tag('by_policy')),
          ...breach(
            'department',
            this.reporting.breachBy(
              facts,
              (fact) => departments.get(String(fact.departmentId)) ?? 'Unassigned',
            ),
          ).map(tag('by_department')),
          ...breach(
            'priority',
            this.reporting.breachBy(facts, (fact) => fact.priority || 'unknown'),
          ).map(tag('by_priority')),
        ];
      }
      case 'csat': {
        const ratings = await this.reporting.ratingFacts(start, end);
        return [
          ...(await this.named(this.reporting.csatByAgent(ratings))).map(tag('by_agent')),
          ...this.reporting.csatOverTime(ratings).map(tag('over_time')),
        ];
      }
      case 'resolution_times':
        return this.reporting.histogram(
          await this.reporting.facts(start),
          'resolvedAt',
          RESOLUTION_BUCKETS,
        );
      default:
        return this.reporting.histogram(
          await this.reporting.facts(start),
          'firstRespondedAt',
          FIRST_RESPONSE_BUCKETS,
        );
    }
  }
}
