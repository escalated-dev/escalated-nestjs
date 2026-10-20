import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds per-deadline SLA breach flags to tickets (`slaFirstResponseBreached`,
 * `slaResolutionBreached`), so each breach is recorded and announced once
 * instead of `sla.breached` firing on every scheduler tick.
 *
 * Tickets already marked `slaBreached` whose deadline is still missed are
 * backfilled as breached, so upgrading does not re-announce them. Register with
 * the host DataSource and run before upgrading.
 */
export class SlaBreachFlags1792454400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { table, column } = this.names(runner);
    for (const name of [column.firstResponse, column.resolution]) {
      await runner.addColumn(
        table,
        new TableColumn({ name, type: 'boolean', isNullable: false, default: false }),
      );
    }

    const q = (name: string) => runner.connection.driver.escape(name);
    const tablePath = table
      .split('.')
      .map((part) => q(part))
      .join('.');
    const backfill = (flag: string, due: string, done: string) =>
      runner.query(
        `UPDATE ${tablePath} SET ${q(flag)} = TRUE WHERE ${q(column.breached)} = TRUE ` +
          `AND ${q(due)} IS NOT NULL AND ${q(due)} < CURRENT_TIMESTAMP AND ${q(done)} IS NULL`,
      );
    await backfill(column.firstResponse, column.firstResponseDueAt, column.firstRespondedAt);
    await backfill(column.resolution, column.resolutionDueAt, column.resolvedAt);
  }

  async down(runner: QueryRunner): Promise<void> {
    const { table, column } = this.names(runner);
    await runner.dropColumn(table, column.resolution);
    await runner.dropColumn(table, column.firstResponse);
  }

  private names(runner: QueryRunner) {
    const ticket = runner.connection.getMetadata('Ticket');
    const name = (property: string) =>
      ticket.findColumnWithPropertyName(property)?.databaseName ?? property;
    return {
      table: ticket.tablePath,
      column: {
        firstResponse: name('slaFirstResponseBreached'),
        resolution: name('slaResolutionBreached'),
        breached: name('slaBreached'),
        firstResponseDueAt: name('firstResponseDueAt'),
        firstRespondedAt: name('firstRespondedAt'),
        resolutionDueAt: name('resolutionDueAt'),
        resolvedAt: name('resolvedAt'),
      },
    };
  }
}
