import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { TicketAccessAndRouting1791918000000 } from '../../src/migrations/1791918000000-TicketAccessAndRouting';

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

describe.each(databases)('ticket access migration on %s', (_name, options) => {
  it('preserves existing rows, indexes account pairs, and rolls back with a custom prefix', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'access_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const targets = ['Department', 'Ticket', 'SlaPolicy', 'EscalationRule'];
    try {
      for (const target of targets) {
        await runner.createTable(
          new Table({
            name: source.getMetadata(target).tablePath,
            columns: [{ name: 'id', type: 'int', isPrimary: true }],
          }),
        );
      }
      const ticketTable = source.getMetadata('Ticket').tablePath;
      const escape = (value: string) => source.driver.escape(value);
      await runner.query(`INSERT INTO ${escape(ticketTable)} (${escape('id')}) VALUES (1)`);
      const migration = new TicketAccessAndRouting1791918000000();
      await migration.up(runner);
      const ticket = await runner.getTable(ticketTable);
      expect(ticket!.columns.find((column) => column.name === 'accountId')!.isNullable).toBe(true);
      expect(
        ticket!.indices.some((index) => index.columnNames.join(',') === 'accountType,accountId'),
      ).toBe(true);
      const [row] = await runner.query(`SELECT ${escape('accountId')} FROM ${escape(ticketTable)}`);
      expect(row.accountId).toBeNull();
      await migration.down(runner);
      expect(await runner.hasColumn(ticketTable, 'accountId')).toBe(false);
      expect(await runner.query(`SELECT ${escape('id')} FROM ${escape(ticketTable)}`)).toEqual([
        { id: 1 },
      ]);
    } finally {
      for (const target of [...targets].reverse()) {
        const table = source.getMetadata(target).tablePath;
        if (await runner.hasTable(table)) await runner.dropTable(table);
      }
      await runner.release();
      await source.destroy();
    }
  });
});
