import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { WidgetTicketMetadata1792281600000 } from '../../src/migrations/1792281600000-WidgetTicketMetadata';

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

describe.each(databases)('widget ticket metadata migration on %s', (_name, options) => {
  it('adds a nullable metadata column that keeps existing rows, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'metadata_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata('Ticket').tablePath;
    const escape = (value: string) => source.driver.escape(value);
    try {
      await runner.createTable(
        new Table({ name: table, columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
      );
      await runner.query(`INSERT INTO ${escape(table)} (${escape('id')}) VALUES (1)`);
      const migration = new WidgetTicketMetadata1792281600000();

      await migration.up(runner);
      const column = (await runner.getTable(table))!.columns.find((c) => c.name === 'metadata');
      expect(column?.isNullable).toBe(true);
      const [row] = await runner.query(`SELECT ${escape('metadata')} FROM ${escape(table)}`);
      expect(row.metadata).toBeNull();
      await runner.query(
        `UPDATE ${escape(table)} SET ${escape('metadata')} = '{"plan":"pro"}' WHERE ${escape('id')} = 1`,
      );

      await migration.down(runner);
      expect(await runner.hasColumn(table, 'metadata')).toBe(false);
      expect(await runner.query(`SELECT ${escape('id')} FROM ${escape(table)}`)).toEqual([
        { id: 1 },
      ]);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
