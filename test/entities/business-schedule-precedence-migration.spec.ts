import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { BusinessSchedulePrecedence1792800000000 } from '../../src/migrations/1792800000000-BusinessSchedulePrecedence';

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

describe.each(databases)('business schedule precedence migration on %s', (_name, options) => {
  it('adds the policy flag unset and the department schedule empty, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'bsp_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const policies = source.getMetadata('SlaPolicy').tablePath;
    const departments = source.getMetadata('Department').tablePath;
    const e = (value: string) => source.driver.escape(value);
    try {
      for (const table of [policies, departments]) {
        await runner.createTable(
          new Table({ name: table, columns: [{ name: 'id', type: 'int', isPrimary: true }] }),
        );
        await runner.query(`INSERT INTO ${e(table)} (${e('id')}) VALUES (1)`);
      }
      const migration = new BusinessSchedulePrecedence1792800000000();

      await migration.up(runner);
      const [policy] = await runner.query(
        `SELECT ${e('businessHoursOnly')} AS flag FROM ${e(policies)}`,
      );
      const [department] = await runner.query(
        `SELECT ${e('businessScheduleId')} AS schedule FROM ${e(departments)}`,
      );
      expect(Boolean(policy.flag)).toBe(false);
      expect(department.schedule).toBeNull();

      await migration.down(runner);
      expect(await runner.hasColumn(policies, 'businessHoursOnly')).toBe(false);
      expect(await runner.hasColumn(departments, 'businessScheduleId')).toBe(false);
    } finally {
      for (const table of [policies, departments])
        if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
