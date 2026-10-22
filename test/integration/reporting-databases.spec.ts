import { DataSource, DataSourceOptions } from 'typeorm';
import * as entities from '../../src/entities';
import { Department, SatisfactionRating, SlaPolicy, Ticket } from '../../src/entities';
import {
  bucketOf,
  FIRST_RESPONSE_BUCKETS,
  periodDays,
  ReportingService,
} from '../../src/services/reporting.service';
import { REPORT_AGENT, seedReports } from './report-fixtures';

jest.setTimeout(120000);

/**
 * The reporting queries on every database the README promises: SQLite always,
 * PostgreSQL and MySQL when ESCALATED_TEST_POSTGRES_URL / ESCALATED_TEST_MYSQL_URL
 * point at throwaway databases (their schema is dropped).
 */
const databases: Array<[string, DataSourceOptions]> = [
  ['SQLite', { type: 'better-sqlite3', database: ':memory:' }],
];
if (process.env.ESCALATED_TEST_POSTGRES_URL)
  databases.push([
    'PostgreSQL',
    { type: 'postgres', url: process.env.ESCALATED_TEST_POSTGRES_URL, dropSchema: true },
  ]);
if (process.env.ESCALATED_TEST_MYSQL_URL)
  databases.push([
    'MySQL',
    { type: 'mysql', url: process.env.ESCALATED_TEST_MYSQL_URL, dropSchema: true },
  ]);

describe.each(databases)('reporting queries on %s', (_name, options) => {
  let source: DataSource;
  let reporting: ReportingService;
  let seeded: Awaited<ReturnType<typeof seedReports>>;
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const start = new Date(now.getTime() - 30 * 86_400_000);
  // Ratings get their time from the database clock, which a PostgreSQL `timestamp`
  // column reads back in the process's zone; a day of slack keeps them in.
  const end = new Date(now.getTime() + 86_400_000);

  beforeAll(async () => {
    source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      synchronize: true,
    } as DataSourceOptions);
    await source.initialize();
    seeded = await seedReports(source, now);
    reporting = new ReportingService(
      source.getRepository(Ticket),
      source.getRepository(SatisfactionRating),
      source.getRepository(SlaPolicy),
      source.getRepository(Department),
    );
  });

  afterAll(async () => {
    await source?.destroy();
  });

  it('selects the period, with times worked out the same everywhere', async () => {
    const facts = await reporting.facts(start, end);
    expect(facts.map((f) => f.id).sort()).toEqual(
      [seeded.answered.id, seeded.waiting.id, seeded.fresh.id].sort(),
    );
    expect(reporting.averageHours(facts, 'firstRespondedAt')).toBe(1.3);
    expect(reporting.averageHours(facts, 'resolvedAt')).toBe(6);
    expect(reporting.slaCompliance(facts)).toBe(50);
    expect(reporting.breachCounts(facts)).toEqual({
      total: 1,
      rate: 33.3,
      first_response: 1,
      resolution: 0,
    });
    expect(reporting.histogram(facts, 'firstRespondedAt', FIRST_RESPONSE_BUCKETS)).toEqual([
      { bucket: '<1h', count: 1, percentage: 50 },
      { bucket: '1-4h', count: 1, percentage: 50 },
      { bucket: '4-8h', count: 0, percentage: 0 },
      { bucket: '8-24h', count: 0, percentage: 0 },
      { bucket: '>24h', count: 0, percentage: 0 },
    ]);
    expect(reporting.agentPerformance(facts)).toEqual([
      {
        agent_id: expect.anything(),
        total_tickets: 2,
        resolved_tickets: 1,
        avg_response_hours: 1.3,
        avg_resolution_hours: 6,
      },
    ]);
    expect(String(reporting.agentPerformance(facts)[0].agent_id)).toBe(String(REPORT_AGENT));
    expect(await reporting.resolvedSince(start)).toBe(1);
  });

  it('reads ratings with the rated ticket’s agent, and ranks agents', async () => {
    const facts = await reporting.facts(start, end);
    const ratings = await reporting.ratingFacts(start, end);
    expect(reporting.csatAverage(ratings)).toBe(3);
    expect(reporting.csatByAgent(ratings)).toEqual([
      { agent_id: expect.anything(), avg_rating: 3, total_ratings: 2 },
    ]);
    expect(reporting.csatOverTime(ratings)).toEqual([
      { label: bucketOf(ratings[0].createdAt), value: 3 },
    ]);
    expect(reporting.agentRanking(facts, ratings)).toEqual([
      expect.objectContaining({
        total_tickets: 2,
        resolution_rate: 50,
        avg_response_hours: 1.3,
        csat_average: 3,
        composite_score: 54.2,
        rank: 1,
      }),
    ]);
  });

  it('groups by status, priority, policy and tag in SQL', async () => {
    const facts = await reporting.facts(start, end);
    expect(await reporting.countByStatus()).toEqual(
      expect.arrayContaining([
        { label: 'open', value: 3 },
        { label: 'resolved', value: 1 },
      ]),
    );
    expect(await reporting.countByPriority(start)).toEqual(
      expect.arrayContaining([
        { label: 'high', value: 1 },
        { label: 'low', value: 1 },
        { label: 'medium', value: 1 },
      ]),
    );
    expect(await reporting.complianceByPolicy(facts)).toEqual([
      { policy_name: 'Gold', total: 2, met: 1, breached: 1 },
    ]);
    const tags = await reporting.tagCohorts(facts);
    const ratings = await reporting.ratingFacts(start, end);
    expect(reporting.cohorts(tags, ratings)).toEqual([
      {
        name: 'vip',
        volume: 1,
        resolved: 1,
        avg_resolution_hours: 6,
        breached: 1,
        breach_rate: 100,
        csat: 4,
      },
    ]);
    const breached = await reporting.breachedTickets(start, end);
    expect(breached.map((t) => t.id)).toEqual([seeded.answered.id]);
  });

  it('lists open tickets about to miss a deadline, soonest first', async () => {
    expect(await reporting.atRiskTickets(8, 50, now)).toEqual([
      {
        id: seeded.fresh.id,
        reference: 'REP-3',
        subject: 'Report ticket 3',
        hours_remaining: 0.5,
      },
      {
        id: seeded.waiting.id,
        reference: 'REP-2',
        subject: 'Report ticket 2',
        hours_remaining: 2,
      },
    ]);
  });

  it('buckets dates by day, ISO week and month in UTC', () => {
    const date = new Date('2027-01-01T23:30:00Z');
    expect(bucketOf(date)).toBe('2027-01-01');
    expect(bucketOf(date, 'week')).toBe('2026-W53');
    expect(bucketOf(date, 'month')).toBe('2027-01');
    expect(periodDays({ period: '7', days: '90' })).toBe(7);
    expect(periodDays({ days: '90' })).toBe(90);
    expect(periodDays({})).toBe(30);
  });
});
