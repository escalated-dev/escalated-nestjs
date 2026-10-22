import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
import { SYSTEM_STATUS_SLUGS, TERMINAL_STATUS_SLUGS } from '../entities/status-category';

/**
 * Status categories as escalated-laravel has them: adds `category`,
 * `description` and `isSystem` to ticket statuses. Existing rows get a
 * category from `isClosed` and their slug (`solved` when closed or slugged
 * `resolved`/`closed`, `pending` for `waiting_on_customer`/`pending`,
 * `on_hold` for `snoozed`, otherwise `open`), `isClosed` is set on every
 * solved row, and rows with a built-in slug become system rows. Tickets are
 * not touched. Register with the host DataSource and run before upgrading.
 */
export class TicketStatusCategories1792886400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { table, column } = this.names(runner);
    await runner.addColumns(table, [
      new TableColumn({ name: column.category, type: 'varchar', length: '20', isNullable: true }),
      new TableColumn({ name: column.description, type: 'text', isNullable: true }),
      new TableColumn({
        name: column.isSystem,
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    ]);

    const e = (name: string) => runner.connection.driver.escape(name);
    const yes = runner.connection.options.type === 'postgres' ? 'TRUE' : '1';
    const list = (values: string[]) => values.map((v) => `'${v}'`).join(', ');
    const t = e(table);
    const [category, isClosed, slug, isSystem] = [
      e(column.category),
      e(column.isClosed),
      e(column.slug),
      e(column.isSystem),
    ];
    await runner.query(
      `UPDATE ${t} SET ${category} = 'solved' WHERE ${isClosed} = ${yes} OR ${slug} IN (${list(TERMINAL_STATUS_SLUGS)})`,
    );
    await runner.query(
      `UPDATE ${t} SET ${category} = 'pending' WHERE ${category} IS NULL AND ${slug} IN ('waiting_on_customer', 'pending')`,
    );
    await runner.query(
      `UPDATE ${t} SET ${category} = 'on_hold' WHERE ${category} IS NULL AND ${slug} = 'snoozed'`,
    );
    await runner.query(`UPDATE ${t} SET ${category} = 'open' WHERE ${category} IS NULL`);
    await runner.query(`UPDATE ${t} SET ${isClosed} = ${yes} WHERE ${category} = 'solved'`);
    await runner.query(
      `UPDATE ${t} SET ${isSystem} = ${yes} WHERE ${slug} IN (${list(SYSTEM_STATUS_SLUGS)})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const { table, column } = this.names(runner);
    await runner.dropColumn(table, column.isSystem);
    await runner.dropColumn(table, column.description);
    await runner.dropColumn(table, column.category);
  }

  private names(runner: QueryRunner) {
    const metadata = runner.connection.getMetadata('TicketStatus');
    const column = (property: string) =>
      metadata.findColumnWithPropertyName(property)?.databaseName ?? property;
    return {
      table: metadata.tablePath,
      column: {
        category: column('category'),
        description: column('description'),
        isSystem: column('isSystem'),
        isClosed: column('isClosed'),
        slug: column('slug'),
      },
    };
  }
}
