import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { userIdColumnType } from '../config/user-id-column';

/**
 * `escalated_two_factor`: each staff user's TOTP enrolment, sealed at rest,
 * with the last accepted time step so a code works once (ADR
 * 2026-10-29-configurable-access-features). Enrolments kept on the agent
 * profile by earlier versions move here on first use.
 */
export class TwoFactor1793491200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const meta = runner.connection.getMetadata('TwoFactor');
    const column = (property: string) =>
      meta.findColumnWithPropertyName(property)?.databaseName ?? property;
    const timestamp = runner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
    const userType = userIdColumnType() as string;
    const unique =
      meta.indices.find((i) => i.isUnique && i.columns.some((c) => c.propertyName === 'userId'))
        ?.name ??
      meta.uniques.find((u) => u.columns.some((c) => c.propertyName === 'userId'))?.name ??
      `UQ_${meta.tableName}_user`.slice(0, 63);

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
          {
            name: column('userId'),
            type: userType,
            ...(userType === 'varchar' ? { length: '255' } : {}),
          },
          { name: column('secret'), type: 'text' },
          { name: column('recoveryCodes'), type: 'text', isNullable: true },
          { name: column('confirmedAt'), type: timestamp, isNullable: true },
          { name: column('lastUsedStep'), type: 'integer', isNullable: true },
          { name: column('createdAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
          { name: column('updatedAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [{ name: unique, columnNames: [column('userId')] }],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable(runner.connection.getMetadata('TwoFactor').tablePath, true, true, true);
  }
}
