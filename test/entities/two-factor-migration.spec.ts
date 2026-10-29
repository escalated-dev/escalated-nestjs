import { DataSource, DataSourceOptions } from 'typeorm';
import { TwoFactor } from '../../src/entities';
import { TwoFactor1793491200000 } from '../../src/migrations/1793491200000-TwoFactor';

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

describe.each(databases)('two-factor migration on %s', (_name, options) => {
  it('creates escalated_two_factor, one enrolment per user, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: [TwoFactor],
      entityPrefix: 'tf_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata(TwoFactor).tablePath;
    const migration = new TwoFactor1793491200000();
    try {
      await migration.up(runner);

      const repo = source.getRepository(TwoFactor);
      const confirmedAt = new Date('2026-10-29T10:00:00.000Z');
      await repo.save({
        userId: 7,
        secret: 'v1:sealed',
        recoveryCodes: 'v1:codes',
        confirmedAt,
        lastUsedStep: 59_000_000,
      });
      const row = await repo.findOneByOrFail({ userId: 7 });
      expect(row).toMatchObject({ secret: 'v1:sealed', lastUsedStep: 59_000_000 });
      expect(new Date(row.confirmedAt!).getTime()).toBe(confirmedAt.getTime());
      await expect(repo.insert({ userId: 7, secret: 'again' })).rejects.toThrow();
      await repo.save({ userId: 8, secret: 'x'.repeat(2000), recoveryCodes: null });

      await migration.down(runner);
      expect(await runner.hasTable(table)).toBe(false);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
