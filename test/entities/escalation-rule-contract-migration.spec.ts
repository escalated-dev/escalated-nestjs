import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { EscalationRuleContract1792713600000 } from '../../src/migrations/1792713600000-EscalationRuleContract';

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

describe.each(databases)('escalation rule contract migration on %s', (_name, options) => {
  it('makes the policy optional, adds the fire log, keeps existing rules, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'esc_rule_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const rules = source.getMetadata('EscalationRule').tablePath;
    const executions = source.getMetadata('RuleExecution').tablePath;
    const e = (value: string) => source.driver.escape(value);
    try {
      await runner.createTable(
        new Table({
          name: rules,
          columns: [
            { name: 'id', type: 'int', isPrimary: true },
            { name: 'slaPolicyId', type: 'int' },
            { name: 'name', type: 'varchar', length: '255' },
          ],
        }),
      );
      await runner.query(
        `INSERT INTO ${e(rules)} (${e('id')}, ${e('slaPolicyId')}, ${e('name')}) VALUES (1, 7, 'Old')`,
      );
      const migration = new EscalationRuleContract1792713600000();

      await migration.up(runner);
      expect(await runner.hasColumn(rules, 'description')).toBe(true);
      expect(await runner.hasColumn(rules, 'repeatAfterHours')).toBe(true);
      await runner.query(
        `INSERT INTO ${e(rules)} (${e('id')}, ${e('slaPolicyId')}, ${e('name')}) VALUES (2, NULL, 'New')`,
      );
      const kept = await runner.query(
        `SELECT ${e('slaPolicyId')} AS policy FROM ${e(rules)} WHERE ${e('id')} = 1`,
      );
      expect(Number(kept[0].policy)).toBe(7);

      const log = source.getRepository('RuleExecution');
      const keys = { ruleType: 'escalation_rule', ruleId: 1, ticketId: 5 };
      await log.insert({ ...keys, firedAt: new Date() });
      await expect(log.insert({ ...keys, firedAt: new Date() })).rejects.toThrow();

      await migration.down(runner);
      expect(await runner.hasTable(executions)).toBe(false);
      expect(await runner.hasColumn(rules, 'repeatAfterHours')).toBe(false);
      const left = await runner.query(`SELECT ${e('id')} AS id FROM ${e(rules)}`);
      expect(left.map((row: any) => Number(row.id))).toEqual([1]);
    } finally {
      if (await runner.hasTable(executions)) await runner.dropTable(executions);
      if (await runner.hasTable(rules)) await runner.dropTable(rules);
      await runner.release();
      await source.destroy();
    }
  });
});
