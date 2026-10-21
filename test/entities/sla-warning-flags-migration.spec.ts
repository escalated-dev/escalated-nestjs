import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { SlaWarningFlags1792540800000 } from '../../src/migrations/1792540800000-SlaWarningFlags';

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

describe.each(databases)('SLA warning flags migration on %s', (_name, options) => {
  it('adds the flags unset on existing tickets, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'sla_warn_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata('Ticket').tablePath;
    const e = (value: string) => source.driver.escape(value);
    try {
      await runner.createTable(
        new Table({ name: table, columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
      );
      await runner.query(`INSERT INTO ${e(table)} (${e('id')}) VALUES (1)`);
      const migration = new SlaWarningFlags1792540800000();

      await migration.up(runner);
      const rows = await runner.query(
        `SELECT ${e('slaFirstResponseWarned')} AS fr, ${e('slaResolutionWarned')} AS res FROM ${e(table)}`,
      );
      expect(rows.map((row: any) => [Boolean(row.fr), Boolean(row.res)])).toEqual([[false, false]]);

      await migration.down(runner);
      expect(await runner.hasColumn(table, 'slaFirstResponseWarned')).toBe(false);
      expect(await runner.hasColumn(table, 'slaResolutionWarned')).toBe(false);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
