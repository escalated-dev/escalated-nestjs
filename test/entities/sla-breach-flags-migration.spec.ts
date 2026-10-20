import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { SlaBreachFlags1792454400000 } from '../../src/migrations/1792454400000-SlaBreachFlags';

jest.setTimeout(60000);

const databases: Array<[string, DataSourceOptions]> = [
  ['SQLite', { type: 'better-sqlite3', database: ':memory:' }],
];
if (process.env.ESCALATED_TEST_POSTGRES_URL)
  databases.push([
    'PostgreSQL',
    { type: 'postgres', url: process.env.ESCALATED_TEST_POSTGRES_URL },
  ]);
if (process.env.ESCALATED_TEST_MYSQL_URL)
  databases.push(['MySQL', { type: 'mysql', url: process.env.ESCALATED_TEST_MYSQL_URL }]);

describe.each(databases)('SLA breach flags migration on %s', (_name, options) => {
  it('adds the flags, backfills tickets already past a deadline, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'sla_flags_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata('Ticket').tablePath;
    const e = (value: string) => source.driver.escape(value);
    try {
      await runner.createTable(
        new Table({
          name: table,
          columns: [
            { name: 'id', type: 'int', isPrimary: true },
            { name: 'slaBreached', type: 'boolean', default: false },
            { name: 'firstResponseDueAt', type: 'timestamp', isNullable: true },
            { name: 'firstRespondedAt', type: 'timestamp', isNullable: true },
            { name: 'resolutionDueAt', type: 'timestamp', isNullable: true },
            { name: 'resolvedAt', type: 'timestamp', isNullable: true },
          ],
        }),
      );
      // 1: breached first response, resolution not yet due.
      // 2: breached both deadlines. 3: never breached.
      await runner.query(
        `INSERT INTO ${e(table)} (${e('id')}, ${e('slaBreached')}, ${e('firstResponseDueAt')}, ${e('resolutionDueAt')}) VALUES ` +
          `(1, TRUE, '2020-01-01 00:00:00', '2999-01-01 00:00:00'), ` +
          `(2, TRUE, '2020-01-01 00:00:00', '2020-01-02 00:00:00'), ` +
          `(3, FALSE, '2020-01-01 00:00:00', '2020-01-02 00:00:00')`,
      );
      const migration = new SlaBreachFlags1792454400000();

      await migration.up(runner);
      const rows = await runner.query(
        `SELECT ${e('id')}, ${e('slaFirstResponseBreached')} AS fr, ${e('slaResolutionBreached')} AS res FROM ${e(table)} ORDER BY ${e('id')}`,
      );
      expect(rows.map((row: any) => [Number(row.id), Boolean(row.fr), Boolean(row.res)])).toEqual([
        [1, true, false],
        [2, true, true],
        [3, false, false],
      ]);

      await migration.down(runner);
      expect(await runner.hasColumn(table, 'slaFirstResponseBreached')).toBe(false);
      expect(await runner.hasColumn(table, 'slaResolutionBreached')).toBe(false);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
