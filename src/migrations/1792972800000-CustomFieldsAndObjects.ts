import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

/**
 * Custom fields and custom objects as escalated-laravel has them: adds
 * `placeholder`, `description`, `validationRules` and `conditions` to custom
 * field definitions (existing rows keep everything and get nulls), and creates
 * the custom object and custom object record tables (records go with their
 * object). Register with the host DataSource and run before upgrading.
 */
export class CustomFieldsAndObjects1792972800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { field, object, record, column, index } = this.names(runner);

    await runner.addColumns(field.tablePath, [
      new TableColumn({
        name: column(field, 'placeholder'),
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
      new TableColumn({ name: column(field, 'description'), type: 'text', isNullable: true }),
      new TableColumn({ name: column(field, 'validationRules'), type: 'text', isNullable: true }),
      new TableColumn({ name: column(field, 'conditions'), type: 'text', isNullable: true }),
    ]);

    await runner.createTable(
      new Table({
        name: object.tablePath,
        columns: [
          {
            name: column(object, 'id'),
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: column(object, 'name'), type: 'varchar', length: '255' },
          { name: column(object, 'slug'), type: 'varchar', length: '100' },
          { name: column(object, 'fieldsSchema'), type: 'text' },
          {
            name: column(object, 'createdAt'),
            type: this.timestamp(runner),
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: column(object, 'updatedAt'),
            type: this.timestamp(runner),
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [
          { name: index.objectSlug, columnNames: [column(object, 'slug')], isUnique: true },
        ],
      }),
    );

    await runner.createTable(
      new Table({
        name: record.tablePath,
        columns: [
          {
            name: column(record, 'id'),
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: column(record, 'objectId'), type: 'int' },
          { name: column(record, 'data'), type: 'text' },
          {
            name: column(record, 'createdAt'),
            type: this.timestamp(runner),
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: column(record, 'updatedAt'),
            type: this.timestamp(runner),
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        indices: [{ name: index.recordObject, columnNames: [column(record, 'objectId')] }],
        foreignKeys: [
          {
            name: index.recordForeignKey,
            columnNames: [column(record, 'objectId')],
            referencedTableName: object.tablePath,
            referencedColumnNames: [column(object, 'id')],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const { field, object, record, column } = this.names(runner);
    await runner.dropTable(record.tablePath, true, true, true);
    await runner.dropTable(object.tablePath, true, true, true);
    for (const property of ['conditions', 'validationRules', 'description', 'placeholder']) {
      await runner.dropColumn(field.tablePath, column(field, property));
    }
  }

  private timestamp(runner: QueryRunner): string {
    return runner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
  }

  private names(runner: QueryRunner) {
    const field = runner.connection.getMetadata('CustomField');
    const object = runner.connection.getMetadata('CustomObject');
    const record = runner.connection.getMetadata('CustomObjectRecord');
    const column = (meta: typeof field, property: string) =>
      meta.findColumnWithPropertyName(property)?.databaseName ?? property;
    const slugIndex = object.indices.find((i) => i.columns.some((c) => c.propertyName === 'slug'));
    const objectIndex = record.indices.find((i) =>
      i.columns.some((c) => c.propertyName === 'objectId'),
    );
    return {
      field,
      object,
      record,
      column,
      index: {
        objectSlug: slugIndex?.name ?? `IDX_${object.tableName}_slug`.slice(0, 63),
        recordObject: objectIndex?.name ?? `IDX_${record.tableName}_objectId`.slice(0, 63),
        recordForeignKey:
          record.foreignKeys[0]?.name ?? `FK_${record.tableName}_objectId`.slice(0, 63),
      },
    };
  }
}
