import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

/**
 * Verified guest access (docs/guest-access.md): the emailed-code table and
 * four nullable ticket columns for the proven email and the current grant.
 * Register with the host DataSource and run before upgrading.
 */
export class VerifiedGuestAccess1792627200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { ticket, verification, column, index } = this.names(runner);
    await runner.createTable(
      new Table({
        name: verification.tablePath,
        columns: [
          { name: column(verification, 'id'), type: 'varchar', length: '36', isPrimary: true },
          { name: column(verification, 'emailDigest'), type: 'varchar', length: '64' },
          { name: column(verification, 'purpose'), type: 'varchar', length: '20' },
          { name: column(verification, 'codeHash'), type: 'varchar', length: '64' },
          { name: column(verification, 'attempts'), type: 'int', default: 0 },
          { name: column(verification, 'expiresAt'), type: this.timestamp(runner) },
          { name: column(verification, 'usedAt'), type: this.timestamp(runner), isNullable: true },
          {
            name: column(verification, 'createdAt'),
            type: this.timestamp(runner),
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [{ name: index, columnNames: [column(verification, 'expiresAt')] }],
      }),
    );

    await runner.addColumns(ticket.tablePath, [
      new TableColumn({
        name: column(ticket, 'guestVerifiedEmail'),
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: column(ticket, 'guestEmailVerifiedAt'),
        type: this.timestamp(runner),
        isNullable: true,
      }),
      new TableColumn({
        name: column(ticket, 'guestAccessHash'),
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: column(ticket, 'guestAccessExpiresAt'),
        type: this.timestamp(runner),
        isNullable: true,
      }),
    ]);
  }

  async down(runner: QueryRunner): Promise<void> {
    const { ticket, verification, column } = this.names(runner);
    for (const property of [
      'guestAccessExpiresAt',
      'guestAccessHash',
      'guestEmailVerifiedAt',
      'guestVerifiedEmail',
    ]) {
      await runner.dropColumn(ticket.tablePath, column(ticket, property));
    }
    await runner.dropTable(verification.tablePath);
  }

  private timestamp(runner: QueryRunner): string {
    const type = runner.connection.options.type;
    if (type === 'postgres') return 'timestamp';
    if (type === 'mysql' || type === 'mariadb') return 'datetime';
    return 'datetime';
  }

  private names(runner: QueryRunner) {
    const ticket = runner.connection.getMetadata('Ticket');
    const verification = runner.connection.getMetadata('GuestVerification');
    const column = (meta: typeof ticket, property: string) =>
      meta.findColumnWithPropertyName(property)?.databaseName ?? property;
    const index =
      verification.indices[0]?.name ?? `IDX_${verification.tableName}_expiresAt`.slice(0, 63);
    return { ticket, verification, column, index };
  }
}
