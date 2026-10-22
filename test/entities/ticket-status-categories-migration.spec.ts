import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { TicketStatusCategories1792886400000 } from '../../src/migrations/1792886400000-TicketStatusCategories';

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

describe.each(databases)('ticket status categories migration on %s', (_name, options) => {
  it('backfills categories and system rows from the existing statuses, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'st_cat_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata('TicketStatus').tablePath;
    const e = (value: string) => source.driver.escape(value);
    try {
      // The table as earlier releases created it.
      await runner.createTable(
        new Table({
          name: table,
          columns: [
            { name: 'id', type: 'int', isPrimary: true },
            { name: 'name', type: 'varchar', length: '100' },
            { name: 'slug', type: 'varchar', length: '50' },
            { name: 'isClosed', type: 'boolean', default: false },
          ],
        }),
      );
      const rows: Array<[number, string, boolean]> = [
        [1, 'open', false],
        [2, 'waiting_on_customer', false],
        [3, 'snoozed', false],
        [4, 'resolved', false],
        [5, 'closed', true],
        [6, 'done', true],
        [7, 'awaiting_parts', false],
        [8, 'pending', false],
      ];
      for (const [id, slug, closed] of rows) {
        await runner.query(
          `INSERT INTO ${e(table)} (${e('id')}, ${e('name')}, ${e('slug')}, ${e('isClosed')}) ` +
            `VALUES (${id}, '${slug}', '${slug}', ${closed ? 'TRUE' : 'FALSE'})`,
        );
      }
      const migration = new TicketStatusCategories1792886400000();

      await migration.up(runner);
      const after = await runner.query(
        `SELECT ${e('slug')} AS slug, ${e('category')} AS category, ${e('isClosed')} AS closed, ` +
          `${e('isSystem')} AS sys, ${e('description')} AS description ` +
          `FROM ${e(table)} ORDER BY ${e('id')}`,
      );
      expect(
        after.map((row: any) => [row.slug, row.category, Boolean(row.closed), Boolean(row.sys)]),
      ).toEqual([
        ['open', 'open', false, true],
        ['waiting_on_customer', 'pending', false, true],
        ['snoozed', 'on_hold', false, true],
        ['resolved', 'solved', true, true],
        ['closed', 'solved', true, true],
        ['done', 'solved', true, false],
        ['awaiting_parts', 'open', false, false],
        ['pending', 'pending', false, false],
      ]);
      expect(after.every((row: any) => row.description === null)).toBe(true);

      await migration.down(runner);
      for (const column of ['category', 'description', 'isSystem']) {
        expect(await runner.hasColumn(table, column)).toBe(false);
      }
      const kept = await runner.query(`SELECT ${e('id')} AS id FROM ${e(table)}`);
      expect(kept).toHaveLength(rows.length);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
