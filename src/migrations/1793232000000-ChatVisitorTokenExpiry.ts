import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `visitorTokenExpiresAt` to chat sessions: when the widget visitor's chat
 * token stops working (`guestAccess.ttlMinutes` after the chat starts). Chats
 * already in progress keep a null expiry, and the next request with their token
 * gives them a full lifetime, so nobody is cut off by the upgrade. Register with
 * the host DataSource and run before upgrading.
 */
export class ChatVisitorTokenExpiry1793232000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { table, column } = this.names(runner);
    await runner.addColumn(
      table,
      new TableColumn({
        name: column.databaseName,
        type: runner.connection.driver.normalizeType(column),
        isNullable: true,
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const { table, column } = this.names(runner);
    await runner.dropColumn(table, column.databaseName);
  }

  private names(runner: QueryRunner) {
    const session = runner.connection.getMetadata('ChatSession');
    const column = session.findColumnWithPropertyName('visitorTokenExpiresAt')!;
    return { table: session.tablePath, column };
  }
}
