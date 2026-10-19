import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Adds `visitorTokenHash` to chat sessions: the SHA-256 of the token a widget
 * visitor uses to reach their chat. Chats started before this migration have
 * no token and are no longer reachable from the widget. Register with the
 * host DataSource and run before upgrading; new installations may generate
 * their normal TypeORM migration from the entities.
 */
export class WidgetChatVisitorToken1792368000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { table, column, index } = this.names(runner);
    await runner.addColumn(
      table,
      new TableColumn({ name: column, type: 'varchar', length: '64', isNullable: true }),
    );
    await runner.createIndex(
      table,
      new TableIndex({ name: index, columnNames: [column], isUnique: true }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const { table, column, index } = this.names(runner);
    await runner.dropIndex(table, index);
    await runner.dropColumn(table, column);
  }

  private names(runner: QueryRunner) {
    const session = runner.connection.getMetadata('ChatSession');
    const column = session.findColumnWithPropertyName('visitorTokenHash')!;
    const index = session.indices.find((candidate) => candidate.columns.includes(column))!;
    return { table: session.tablePath, column: column.databaseName, index: index.name };
  }
}
