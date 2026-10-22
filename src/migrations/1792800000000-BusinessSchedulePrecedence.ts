import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Business-hours SLA deadlines chosen as escalated-laravel chooses them: adds
 * `businessHoursOnly` to SLA policies (false on existing rows; a policy with
 * its own schedule keeps counting business hours without it) and a nullable
 * `businessScheduleId` to departments. Register with the host DataSource and
 * run before upgrading.
 */
export class BusinessSchedulePrecedence1792800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { policy, department } = this.names(runner);
    await runner.addColumn(
      policy.table,
      new TableColumn({
        name: policy.businessHoursOnly,
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    );
    await runner.addColumn(
      department.table,
      new TableColumn({ name: department.businessScheduleId, type: 'int', isNullable: true }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const { policy, department } = this.names(runner);
    await runner.dropColumn(department.table, department.businessScheduleId);
    await runner.dropColumn(policy.table, policy.businessHoursOnly);
  }

  private names(runner: QueryRunner) {
    const column = (entity: string, property: string) =>
      runner.connection.getMetadata(entity).findColumnWithPropertyName(property)?.databaseName ??
      property;
    return {
      policy: {
        table: runner.connection.getMetadata('SlaPolicy').tablePath,
        businessHoursOnly: column('SlaPolicy', 'businessHoursOnly'),
      },
      department: {
        table: runner.connection.getMetadata('Department').tablePath,
        businessScheduleId: column('Department', 'businessScheduleId'),
      },
    };
  }
}
