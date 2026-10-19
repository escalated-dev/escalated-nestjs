import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `metadata` to tickets: host parameters sent with a widget ticket or
 * chat. Register with the host DataSource and run before upgrading; new
 * installations may generate their normal TypeORM migration from the entities.
 */
export class WidgetTicketMetadata1792281600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const ticket = runner.connection.getMetadata('Ticket');
    await runner.addColumn(
      ticket.tablePath,
      new TableColumn({
        name: ticket.findColumnWithPropertyName('metadata')!.databaseName,
        type: 'text',
        isNullable: true,
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const ticket = runner.connection.getMetadata('Ticket');
    await runner.dropColumn(
      ticket.tablePath,
      ticket.findColumnWithPropertyName('metadata')!.databaseName,
    );
  }
}
