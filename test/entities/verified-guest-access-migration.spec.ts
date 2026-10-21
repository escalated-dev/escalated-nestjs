import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { VerifiedGuestAccess1792627200000 } from '../../src/migrations/1792627200000-VerifiedGuestAccess';

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

describe.each(databases)('verified guest access migration on %s', (_name, options) => {
  it('adds the code table and the ticket grant columns, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'guest_mig_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const tickets = source.getMetadata('Ticket').tablePath;
    const codes = source.getMetadata('GuestVerification').tablePath;
    try {
      await runner.createTable(
        new Table({ name: tickets, columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
      );
      const migration = new VerifiedGuestAccess1792627200000();

      await migration.up(runner);
      for (const column of [
        'guestVerifiedEmail',
        'guestEmailVerifiedAt',
        'guestAccessHash',
        'guestAccessExpiresAt',
      ]) {
        expect(await runner.hasColumn(tickets, column)).toBe(true);
      }
      await source.getRepository('GuestVerification').save({
        id: '7f0f8a53-4f5e-4e7c-9d6b-0a1b2c3d4e5f',
        emailDigest: 'a'.repeat(64),
        purpose: 'ticket',
        codeHash: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 600_000),
      });
      expect(await source.getRepository('GuestVerification').count()).toBe(1);

      await migration.down(runner);
      expect(await runner.hasTable(codes)).toBe(false);
      expect(await runner.hasColumn(tickets, 'guestAccessHash')).toBe(false);
    } finally {
      if (await runner.hasTable(codes)) await runner.dropTable(codes);
      if (await runner.hasTable(tickets)) await runner.dropTable(tickets);
      await runner.release();
      await source.destroy();
    }
  });
});
