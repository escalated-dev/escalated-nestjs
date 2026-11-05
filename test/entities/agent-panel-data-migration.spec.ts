import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { AgentPanelData1793664000000 } from '../../src/migrations/1793664000000-AgentPanelData';

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

describe.each(databases)('agent panel data migration on %s', (_name, options) => {
  it('adds the columns and tables, keeps existing tickets read, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'panel_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const tickets = source.getMetadata('Ticket').tablePath;
    const profiles = source.getMetadata('AgentProfile').tablePath;
    const created = ['TicketRead', 'CustomerPresence', 'AgentNotification'].map(
      (entity) => source.getMetadata(entity).tablePath,
    );
    const e = (value: string) => source.driver.escape(value);
    const yes = options.type === 'postgres' ? 'true' : '1';
    const no = options.type === 'postgres' ? 'false' : '0';
    try {
      await runner.createTable(
        new Table({
          name: tickets,
          columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }),
      );
      await runner.createTable(
        new Table({
          name: profiles,
          columns: [
            { name: 'id', type: 'integer', isPrimary: true },
            { name: 'userId', type: 'integer' },
            { name: 'isAvailable', type: 'boolean' },
          ],
        }),
      );
      await runner.query(`INSERT INTO ${e(tickets)} (${e('id')}) VALUES (1)`);
      await runner.query(
        `INSERT INTO ${e(profiles)} (${e('id')}, ${e('userId')}, ${e('isAvailable')}) VALUES (1, 21, ${yes}), (2, 22, ${no})`,
      );
      const migration = new AgentPanelData1793664000000();

      await migration.up(runner);

      const ticket = await runner.query(
        `SELECT ${e('lastCustomerActivityAt')} AS activity FROM ${e(tickets)}`,
      );
      expect(ticket.map((row: any) => row.activity)).toEqual([null]);
      const statuses = await runner.query(
        `SELECT ${e('userId')} AS u, ${e('chatStatus')} AS s FROM ${e(profiles)} ORDER BY ${e('userId')}`,
      );
      expect(statuses.map((row: any) => [Number(row.u), row.s])).toEqual([
        [21, 'online'],
        [22, 'offline'],
      ]);
      for (const table of created) expect(await runner.hasTable(table)).toBe(true);

      // One read marker per agent and ticket.
      const reads = created[0];
      const marker = `INSERT INTO ${e(reads)} (${e('userId')}, ${e('ticketId')}) VALUES (21, 1)`;
      await runner.query(marker);
      await expect(runner.query(marker)).rejects.toThrow();

      await migration.down(runner);
      for (const table of created) expect(await runner.hasTable(table)).toBe(false);
      expect(await runner.hasColumn(tickets, 'lastCustomerActivityAt')).toBe(false);
      expect(await runner.hasColumn(profiles, 'chatStatus')).toBe(false);
    } finally {
      for (const table of [...created, tickets, profiles]) {
        if (await runner.hasTable(table)) await runner.dropTable(table);
      }
      await runner.release();
      await source.destroy();
    }
  });
});
