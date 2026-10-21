import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds per-deadline SLA warning flags to tickets (`slaFirstResponseWarned`,
 * `slaResolutionWarned`), so `sla.warning` is announced once per deadline.
 * Register with the host DataSource and run before upgrading.
 */
export class SlaWarningFlags1792540800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { table, columns } = this.names(runner);
    for (const name of columns) {
      await runner.addColumn(
        table,
        new TableColumn({ name, type: 'boolean', isNullable: false, default: false }),
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const { table, columns } = this.names(runner);
    for (const name of [...columns].reverse()) {
      await runner.dropColumn(table, name);
    }
  }

  private names(runner: QueryRunner) {
    const ticket = runner.connection.getMetadata('Ticket');
    const name = (property: string) =>
      ticket.findColumnWithPropertyName(property)?.databaseName ?? property;
    return {
      table: ticket.tablePath,
      columns: [name('slaFirstResponseWarned'), name('slaResolutionWarned')],
    };
  }
}
