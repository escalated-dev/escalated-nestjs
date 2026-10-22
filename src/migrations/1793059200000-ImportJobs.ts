import { MigrationInterface, QueryRunner, Table, TableColumnOptions } from 'typeorm';
import { userIdColumnType } from '../config/user-id-column';

/**
 * The import framework's tables, as escalated-laravel has them: import jobs
 * (status, sealed credentials, field mappings, per-type progress and cursor,
 * error log) and the source map that makes a run resumable, unique per job,
 * entity type and source id. Register with the host DataSource and run before
 * upgrading.
 */
export class ImportJobs1793059200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { job, map, column, index } = this.names(runner);
    const timestamp = this.timestamp(runner);
    const userIdType = String(userIdColumnType());

    await runner.createTable(
      new Table({
        name: job.tablePath,
        columns: [
          { name: column(job, 'id'), type: 'varchar', length: '36', isPrimary: true },
          {
            name: column(job, 'userId'),
            type: userIdType,
            ...(userIdType === 'varchar' ? { length: '255' } : {}),
            isNullable: true,
          } as TableColumnOptions,
          { name: column(job, 'platform'), type: 'varchar', length: '50' },
          { name: column(job, 'status'), type: 'varchar', length: '30', default: "'pending'" },
          { name: column(job, 'credentials'), type: 'text', isNullable: true },
          { name: column(job, 'fieldMappings'), type: 'text', isNullable: true },
          { name: column(job, 'progress'), type: 'text', isNullable: true },
          { name: column(job, 'errorLog'), type: 'text', isNullable: true },
          { name: column(job, 'startedAt'), type: timestamp, isNullable: true },
          { name: column(job, 'completedAt'), type: timestamp, isNullable: true },
          { name: column(job, 'createdAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
          { name: column(job, 'updatedAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
        ],
        indices: [{ name: index.jobStatus, columnNames: [column(job, 'status')] }],
      }),
    );

    await runner.createTable(
      new Table({
        name: map.tablePath,
        columns: [
          {
            name: column(map, 'id'),
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: column(map, 'importJobId'), type: 'varchar', length: '36' },
          { name: column(map, 'entityType'), type: 'varchar', length: '50' },
          { name: column(map, 'sourceId'), type: 'varchar', length: '191' },
          { name: column(map, 'escalatedId'), type: 'varchar', length: '191' },
          { name: column(map, 'createdAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
        ],
        indices: [
          {
            name: index.mapSource,
            columnNames: [
              column(map, 'importJobId'),
              column(map, 'entityType'),
              column(map, 'sourceId'),
            ],
            isUnique: true,
          },
        ],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const { job, map } = this.names(runner);
    await runner.dropTable(map.tablePath, true, true, true);
    await runner.dropTable(job.tablePath, true, true, true);
  }

  private timestamp(runner: QueryRunner): string {
    return runner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
  }

  private names(runner: QueryRunner) {
    const job = runner.connection.getMetadata('ImportJob');
    const map = runner.connection.getMetadata('ImportSourceMap');
    const column = (meta: typeof job, property: string) =>
      meta.findColumnWithPropertyName(property)?.databaseName ?? property;
    const statusIndex = job.indices.find((i) => i.columns.some((c) => c.propertyName === 'status'));
    const sourceIndex = map.indices.find((i) => i.isUnique);
    return {
      job,
      map,
      column,
      index: {
        jobStatus: statusIndex?.name ?? `IDX_${job.tableName}_status`.slice(0, 63),
        mapSource: sourceIndex?.name ?? `IDX_${map.tableName}_source`.slice(0, 63),
      },
    };
  }
}
