import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { WidgetChatVisitorToken1792368000000 } from '../../src/migrations/1792368000000-WidgetChatVisitorToken';

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

describe.each(databases)('widget chat visitor token migration on %s', (_name, options) => {
  it('adds a nullable, unique token hash that keeps existing chats, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'chat_token_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata('ChatSession').tablePath;
    const escape = (value: string) => source.driver.escape(value);
    try {
      await runner.createTable(
        new Table({ name: table, columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
      );
      await runner.query(`INSERT INTO ${escape(table)} (${escape('id')}) VALUES (1), (2)`);
      const migration = new WidgetChatVisitorToken1792368000000();

      await migration.up(runner);
      const migrated = (await runner.getTable(table))!;
      expect(migrated.columns.find((c) => c.name === 'visitorTokenHash')?.isNullable).toBe(true);
      expect(
        migrated.indices.some((i) => i.isUnique && i.columnNames.includes('visitorTokenHash')),
      ).toBe(true);
      const set = (id: number, hash: string) =>
        runner.query(
          `UPDATE ${escape(table)} SET ${escape('visitorTokenHash')} = '${hash}' WHERE ${escape('id')} = ${id}`,
        );
      await set(1, 'a'.repeat(64));
      await expect(set(2, 'a'.repeat(64))).rejects.toThrow();

      await migration.down(runner);
      expect(await runner.hasColumn(table, 'visitorTokenHash')).toBe(false);
      expect(await runner.query(`SELECT ${escape('id')} FROM ${escape(table)}`)).toEqual([
        { id: 1 },
        { id: 2 },
      ]);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
