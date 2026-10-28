import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { ChatVisitorTokenExpiry1793232000000 } from '../../src/migrations/1793232000000-ChatVisitorTokenExpiry';

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

describe.each(databases)('chat visitor token expiry migration on %s', (_name, options) => {
  it('adds a nullable expiry that leaves chats in progress unexpired, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'chat_expiry_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata('ChatSession').tablePath;
    const escape = (value: string) => source.driver.escape(value);
    try {
      await runner.createTable(
        new Table({ name: table, columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
      );
      await runner.query(`INSERT INTO ${escape(table)} (${escape('id')}) VALUES (1)`);
      const migration = new ChatVisitorTokenExpiry1793232000000();

      await migration.up(runner);
      const migrated = (await runner.getTable(table))!;
      expect(migrated.columns.find((c) => c.name === 'visitorTokenExpiresAt')?.isNullable).toBe(
        true,
      );
      const rows = await runner.query(
        `SELECT ${escape('visitorTokenExpiresAt')} AS ${escape('expires')} FROM ${escape(table)}`,
      );
      expect(rows).toEqual([{ expires: null }]);

      await migration.down(runner);
      expect(await runner.hasColumn(table, 'visitorTokenExpiresAt')).toBe(false);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
