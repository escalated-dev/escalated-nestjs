import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

/**
 * Escalation rules on escalated-laravel's contract: the SLA policy becomes
 * optional (rules from the admin form carry everything in their conditions),
 * rules gain `description` and `repeatAfterHours`, and the fire log
 * (`escalated_rule_executions`) records when a rule last acted on a ticket so
 * it fires once per ticket. Existing rules keep their data and are read in
 * their earlier shape. Register with the host DataSource and run before
 * upgrading.
 */
export class EscalationRuleContract1792713600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { rule, execution, column, policyColumn } = this.names(runner);

    await this.setPolicyNullable(runner, rule.tablePath, policyColumn, true);
    await runner.addColumns(rule.tablePath, [
      new TableColumn({ name: column(rule, 'description'), type: 'text', isNullable: true }),
      new TableColumn({ name: column(rule, 'repeatAfterHours'), type: 'int', isNullable: true }),
    ]);

    await runner.createTable(
      new Table({
        name: execution.tablePath,
        columns: [
          {
            name: column(execution, 'id'),
            // SQLite autoincrements only an INTEGER primary key.
            type: ['sqlite', 'better-sqlite3'].includes(runner.connection.options.type)
              ? 'integer'
              : 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: column(execution, 'ruleType'), type: 'varchar', length: '32' },
          { name: column(execution, 'ruleId'), type: 'int' },
          { name: column(execution, 'ticketId'), type: 'int' },
          { name: column(execution, 'firedAt'), type: this.timestamp(runner) },
          {
            name: column(execution, 'createdAt'),
            type: this.timestamp(runner),
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          {
            name: 'IDX_escalated_rule_exec_unique',
            columnNames: [
              column(execution, 'ruleType'),
              column(execution, 'ruleId'),
              column(execution, 'ticketId'),
            ],
            isUnique: true,
          },
          { name: 'IDX_escalated_rule_exec_ticket', columnNames: [column(execution, 'ticketId')] },
        ],
      }),
    );
  }

  /**
   * Rules without an SLA policy (saved from the admin form) cannot go back to
   * a required policy, so rolling back deletes them.
   */
  async down(runner: QueryRunner): Promise<void> {
    const { rule, execution, column, policyColumn } = this.names(runner);
    await runner.dropTable(execution.tablePath);
    const e = (name: string) => runner.connection.driver.escape(name);
    await runner.query(`DELETE FROM ${e(rule.tablePath)} WHERE ${e(policyColumn)} IS NULL`);
    await runner.dropColumn(rule.tablePath, column(rule, 'repeatAfterHours'));
    await runner.dropColumn(rule.tablePath, column(rule, 'description'));
    await this.setPolicyNullable(runner, rule.tablePath, policyColumn, false);
  }

  private async setPolicyNullable(
    runner: QueryRunner,
    tablePath: string,
    name: string,
    nullable: boolean,
  ): Promise<void> {
    const table = await runner.getTable(tablePath);
    const existing = table?.findColumnByName(name);
    if (!table || !existing || existing.isNullable === nullable) return;
    const changed = existing.clone();
    changed.isNullable = nullable;
    await runner.changeColumn(table, existing, changed);
  }

  private timestamp(runner: QueryRunner): string {
    return runner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
  }

  private names(runner: QueryRunner) {
    const rule = runner.connection.getMetadata('EscalationRule');
    const execution = runner.connection.getMetadata('RuleExecution');
    const column = (meta: typeof rule, property: string) =>
      meta.findColumnWithPropertyName(property)?.databaseName ?? property;
    return { rule, execution, column, policyColumn: column(rule, 'slaPolicyId') };
  }
}
