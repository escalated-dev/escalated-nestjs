import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLog, Reply } from '../../src/entities';
import { apiFetch, bootUi, expectManifestProps, inertiaFetch, page } from './ui-harness';
import { REPORT_AGENT, seedReports } from './report-fixtures';

jest.setTimeout(60000);

/**
 * The admin report screens over real HTTP and SQLite, with escalated-laravel's
 * ReportController as the prop contract: every prop each page reads, in the
 * shape it reads it, computed from a seeded helpdesk (see report-fixtures).
 */
describe('report screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let seeded: Awaited<ReturnType<typeof seedReports>>;
  const asAdmin = { as: 'admin' as const };

  const agentRow = expect.objectContaining({ agent_name: 'Ada' });

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    seeded = await seedReports(source, new Date(Math.floor(Date.now() / 1000) * 1000));
  });

  afterAll(async () => {
    await app?.close();
  });

  const report = async (path: string, component: string) => {
    const result = await page(base, path, asAdmin);
    expect(result.component).toBe(component);
    expectManifestProps(result);
    return result.props;
  };

  it('keeps the reports behind the admin guard', async () => {
    for (const path of [
      '/escalated/admin/reports',
      '/escalated/admin/reports/dashboard',
      '/escalated/admin/reports/export/tickets',
    ]) {
      expect((await inertiaFetch(base, path, { as: 'agent' })).status).toBe(403);
    }
  });

  it('serves the overview (Escalated/Admin/Reports)', async () => {
    const props = await report('/escalated/admin/reports?days=30', 'Escalated/Admin/Reports');
    expect(props).toMatchObject({
      period_days: 30,
      total_tickets: 3,
      resolved_tickets: 1,
      avg_first_response_hours: 1.3,
      sla_breach_count: 1,
      by_status: { open: 2, resolved: 1 },
      by_priority: { high: 1, low: 1, medium: 1 },
      csat: { average: 3, total: 2, breakdown: { 2: 1, 4: 1 } },
    });
  });

  it('serves Escalated/Admin/Reports/Dashboard', async () => {
    const props = await report(
      '/escalated/admin/reports/dashboard',
      'Escalated/Admin/Reports/Dashboard',
    );
    expect(props).toMatchObject({
      period_days: 30,
      avg_response_hours: 1.3,
      avg_resolution_hours: 6,
      sla_compliance: 50,
      csat_average: 3,
    });
    expect(props.volume.reduce((sum: number, row: any) => sum + row.value, 0)).toBe(3);
    expect(props.volume[0]).toEqual({
      label: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      value: expect.any(Number),
    });
    expect(props.by_status).toEqual(
      expect.arrayContaining([
        { label: 'open', value: 3 },
        { label: 'resolved', value: 1 },
      ]),
    );
    expect(props.by_priority).toEqual(expect.arrayContaining([{ label: 'high', value: 2 }]));
    expect(props.agent_performance).toEqual([
      {
        agent_id: REPORT_AGENT,
        agent_name: 'Ada',
        total_tickets: 2,
        resolved_tickets: 1,
        avg_response_hours: 1.3,
        avg_resolution_hours: 6,
      },
    ]);
  });

  it('serves Escalated/Admin/Reports/AgentMetrics', async () => {
    const props = await report(
      '/escalated/admin/reports/agents?days=7',
      'Escalated/Admin/Reports/AgentMetrics',
    );
    expect(props.period_days).toBe(7);
    expect(props.agents).toEqual([agentRow]);
  });

  it('serves Escalated/Admin/Reports/SlaReport', async () => {
    const props = await report('/escalated/admin/reports/sla', 'Escalated/Admin/Reports/SlaReport');
    expect(props.compliance_rate).toBe(50);
    expect(props.compliance_by_policy).toEqual([
      { policy_name: 'Gold', total: 2, met: 1, breached: 1 },
    ]);
    expect(props.breaches).toEqual([
      expect.objectContaining({
        id: seeded.answered.id,
        reference: 'REP-1',
        subject: 'Report ticket 1',
        created_at: expect.any(String),
        sla_first_response_breached: true,
        sla_resolution_breached: false,
        sla_policy: { id: seeded.gold.id, name: 'Gold' },
        assignee: { id: REPORT_AGENT, name: 'Ada' },
      }),
    ]);
  });

  it('serves Escalated/Admin/Reports/CsatReport', async () => {
    const props = await report(
      '/escalated/admin/reports/csat',
      'Escalated/Admin/Reports/CsatReport',
    );
    expect(props).toMatchObject({
      csat_average: 3,
      total_ratings: 2,
      response_rate: 66.7,
    });
    expect(props.by_agent).toEqual([
      { agent_id: REPORT_AGENT, agent_name: 'Ada', avg_rating: 3, total_ratings: 2 },
    ]);
    expect(props.over_time).toEqual([{ label: expect.any(String), value: 3 }]);
  });

  it('serves Escalated/Admin/Reports/SlaTrends', async () => {
    const props = await report(
      '/escalated/admin/reports/sla-trends?group_by=month',
      'Escalated/Admin/Reports/SlaTrends',
    );
    expect(props).toMatchObject({
      total_breaches: 1,
      breach_rate: 33.3,
      first_response_breaches: 1,
      resolution_breaches: 0,
    });
    expect(props.breach_trend).toEqual([
      { label: expect.stringMatching(/^\d{4}-\d{2}$/), value: 1 },
    ]);
    expect(props.breach_by_type_trend).toEqual([{ label: expect.any(String), values: [1, 0] }]);
    expect(props.breach_by_department).toEqual(
      expect.arrayContaining([
        { label: 'Billing', value: 100 },
        { label: 'Unassigned', value: 0 },
      ]),
    );
    expect(props.breach_by_priority).toEqual(
      expect.arrayContaining([
        { label: 'high', value: 100 },
        { label: 'low', value: 0 },
      ]),
    );
    expect(props.at_risk_tickets.map((t: any) => [t.id, t.reference, t.subject])).toEqual([
      [seeded.fresh.id, 'REP-3', 'Report ticket 3'],
      [seeded.waiting.id, 'REP-2', 'Report ticket 2'],
    ]);
    expect(props.at_risk_tickets[0].hours_remaining).toBe(0.5);
  });

  it('serves Escalated/Admin/Reports/ResponseTimes (also at /frt)', async () => {
    const props = await report(
      '/escalated/admin/reports/response-times',
      'Escalated/Admin/Reports/ResponseTimes',
    );
    expect(props).toMatchObject({
      avg_frt: 1.3,
      median_frt: 1.3,
      p90_frt: 1.9,
      pct_under_target: 100,
      target_hours: 4,
    });
    expect(props.distribution.slice(0, 2)).toEqual([
      { label: '<1h', value: 1 },
      { label: '1-4h', value: 1 },
    ]);
    expect(props.trend.map((row: any) => Object.keys(row))).toEqual(
      props.trend.map(() => ['label', 'value']),
    );
    expect(props.by_agent).toEqual([
      { agent_id: REPORT_AGENT, agent_name: 'Ada', count: 2, avg: 1.3, median: 1.3, p90: 1.9 },
    ]);
    expect(props.by_department).toEqual(
      expect.arrayContaining([
        { label: 'Billing', value: 2 },
        { label: 'Unassigned', value: 0.5 },
      ]),
    );
    expect(props.by_priority).toEqual(
      expect.arrayContaining([
        { label: 'high', value: 2 },
        { label: 'low', value: 0.5 },
      ]),
    );
    const frt = await page(base, '/escalated/admin/reports/frt', asAdmin);
    expect(frt.component).toBe('Escalated/Admin/Reports/ResponseTimes');
  });

  it('serves Escalated/Admin/Reports/ResolutionTimes (also at /resolution)', async () => {
    const props = await report(
      '/escalated/admin/reports/resolution-times',
      'Escalated/Admin/Reports/ResolutionTimes',
    );
    expect(props).toMatchObject({
      avg_resolution: 6,
      median_resolution: 6,
      p90_resolution: 6,
      pct_under_target: 100,
      target_hours: 24,
    });
    expect(props.distribution).toEqual([
      { label: '<4h', value: 0 },
      { label: '4-8h', value: 1 },
      { label: '8-24h', value: 0 },
      { label: '1-3d', value: 0 },
      { label: '3-7d', value: 0 },
      { label: '>7d', value: 0 },
    ]);
    expect(props.by_channel).toEqual([{ label: 'email', value: 6 }]);
    expect(props.by_department).toEqual([{ label: 'Billing', value: 6 }]);
    expect(props.by_agent).toEqual([agentRow]);
    const alias = await page(base, '/escalated/admin/reports/resolution', asAdmin);
    expect(alias.component).toBe('Escalated/Admin/Reports/ResolutionTimes');
  });

  it('serves Escalated/Admin/Reports/AgentRanking', async () => {
    const props = await report(
      '/escalated/admin/reports/agent-ranking',
      'Escalated/Admin/Reports/AgentRanking',
    );
    expect(props.agents).toEqual([
      {
        agent_id: REPORT_AGENT,
        agent_name: 'Ada',
        volume: 2,
        resolution_rate: 50,
        avg_frt: 1.3,
        avg_resolution: 6,
        csat: 3,
        composite_score: 54.2,
      },
    ]);
  });

  it('serves Escalated/Admin/Reports/Cohorts', async () => {
    const props = await report(
      '/escalated/admin/reports/cohorts',
      'Escalated/Admin/Reports/Cohorts',
    );
    expect(props.by_tag).toEqual([
      { name: 'vip', volume: 1, avg_resolution: 6, breach_rate: 100, csat: 4 },
    ]);
    expect(props.by_department).toEqual(
      expect.arrayContaining([
        { name: 'Billing', volume: 1, avg_resolution: 6, breach_rate: 100, csat: 4 },
        { name: 'Unassigned', volume: 2, avg_resolution: 0, breach_rate: 0, csat: 2 },
      ]),
    );
    expect(props.by_channel).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'web', volume: 2 })]),
    );
    expect(props.by_type).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'incident', volume: 1 })]),
    );
    expect(props.by_priority).toHaveLength(3);
  });

  it('serves Escalated/Admin/Reports/Comparison', async () => {
    const props = await report(
      '/escalated/admin/reports/comparison?period=30',
      'Escalated/Admin/Reports/Comparison',
    );
    const keys = [
      'total_tickets',
      'resolved_tickets',
      'avg_frt',
      'avg_resolution',
      'sla_compliance',
      'csat',
      'breach_count',
      'volume_trend',
    ];
    expect(Object.keys(props.current).sort()).toEqual([...keys].sort());
    expect(Object.keys(props.previous).sort()).toEqual([...keys].sort());
    expect(props.current).toMatchObject({ total_tickets: 3, resolved_tickets: 1, breach_count: 1 });
    // The 40-day-old ticket falls in the previous 30 days.
    expect(props.previous).toMatchObject({ total_tickets: 1, sla_compliance: 100, csat: 0 });
  });

  it('exports a report as CSV and JSON, and records the export', async () => {
    const csv = await apiFetch(
      base,
      '/escalated/admin/reports/export/agent_performance?period=30',
      asAdmin,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toMatch(
      /attachment; filename="agent_performance_report_/,
    );
    const [header, row] = (await csv.text()).trim().split('\n');
    expect(header.split(',')).toEqual(
      expect.arrayContaining(['agent_id', 'agent_name', 'composite_score', 'rank']),
    );
    expect(row).toContain('Ada');

    const json = await apiFetch(
      base,
      '/escalated/admin/reports/export/sla_compliance?format=json',
      asAdmin,
    );
    const body = await json.json();
    expect(body).toMatchObject({ report_type: 'sla_compliance', filters: { period: 30 } });
    expect(body.data).toContainEqual({
      policy_name: 'Gold',
      total: 2,
      met: 1,
      breached: 1,
      metric: 'by_policy',
    });

    expect((await apiFetch(base, '/escalated/admin/reports/export/nope', asAdmin)).status).toBe(
      400,
    );
    expect(await source.getRepository(AuditLog).countBy({ action: 'report.exported' })).toBe(2);
  });

  it('serves Escalated/Admin/Reports/AgentDetail under the names the component reads', async () => {
    await source.getRepository(Reply).save({
      ticketId: seeded.waiting.id,
      userId: REPORT_AGENT,
      body: 'On it',
      type: 'reply',
    } as Partial<Reply>);

    const props = await report(
      `/escalated/admin/reports/agent/${REPORT_AGENT}/detail?days=30`,
      'Escalated/Admin/Reports/AgentDetail',
    );
    expect(props).toMatchObject({
      period_days: 30,
      agent: { id: REPORT_AGENT, name: 'Ada', email: null },
      total_tickets: 2,
      resolved_tickets: 1,
      avg_frt: 1.3,
      avg_resolution: 6,
      csat_score: 3,
      prev_total_tickets: 0,
      prev_resolved_tickets: 0,
      prev_avg_frt: 0,
      prev_avg_resolution: 0,
      prev_csat_score: null,
    });
    expect(Object.keys(props.response_percentiles).sort()).toEqual([
      'p50',
      'p75',
      'p90',
      'p95',
      'p99',
    ]);
    expect(props.response_percentiles.p50).toBe(1.3);
    expect(props.csat_breakdown).toEqual([
      { label: '2 stars', value: 1 },
      { label: '4 stars', value: 1 },
    ]);
    expect(props.workload.reduce((sum: number, row: any) => sum + row.value, 0)).toBe(2);
    expect(props.workload[0]).toEqual({
      label: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      value: expect.any(Number),
    });
    // One reply written and one ticket resolved, per day.
    const written = props.productivity.reduce((sum: number, row: any) => sum + row.values[0], 0);
    const resolved = props.productivity.reduce((sum: number, row: any) => sum + row.values[1], 0);
    expect([written, resolved]).toEqual([1, 1]);
    for (const row of props.productivity) expect(row.value).toBe(row.values[0] + row.values[1]);

    const unknown = await page(base, '/escalated/admin/reports/agent/9999/detail', asAdmin);
    expect(unknown.props.agent).toEqual({ id: 9999, name: 'User #9999', email: null });
    expect(unknown.props.total_tickets).toBe(0);
  });
});
