import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * `escalated_sso_message_ids` (ADR 2026-10-29-configurable-access-features):
 * the SAML requests Escalated issued and the SAML assertion IDs and JWT `jti`s
 * it accepted, so each is answered or used once. Unique on kind + message ID.
 */
export class SsoMessageIds1793577600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const meta = runner.connection.getMetadata('SsoMessageId');
    const column = (property: string) =>
      meta.findColumnWithPropertyName(property)?.databaseName ?? property;
    const index = (unique: boolean, property: string) =>
      meta.indices.find(
        (i) => i.isUnique === unique && i.columns.some((c) => c.propertyName === property),
      )?.name;

    await runner.createTable(
      new Table({
        name: meta.tablePath,
        columns: [
          {
            name: column('id'),
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: column('kind'), type: 'varchar', length: '32' },
          { name: column('messageId'), type: 'varchar', length: '191' },
          { name: column('expiresAt'), type: 'bigint' },
        ],
        indices: [
          {
            name: index(true, 'messageId') ?? `IDX_${meta.tableName}_kind_message`.slice(0, 63),
            columnNames: [column('kind'), column('messageId')],
            isUnique: true,
          },
          {
            name: index(false, 'expiresAt') ?? `IDX_${meta.tableName}_expires`.slice(0, 63),
            columnNames: [column('expiresAt')],
          },
        ],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable(
      runner.connection.getMetadata('SsoMessageId').tablePath,
      true,
      true,
      true,
    );
  }
}
