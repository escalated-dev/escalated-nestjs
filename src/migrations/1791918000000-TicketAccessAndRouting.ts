import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

/** Register with the host DataSource and run before enabling ticket access options. */
export class TicketAccessAndRouting1791918000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const ticket = runner.connection.getMetadata('Ticket');
    const sla = runner.connection.getMetadata('SlaPolicy');
    const rule = runner.connection.getMetadata('EscalationRule');
    const department = runner.connection.getMetadata('Department');
    const name = (metadata: typeof ticket, property: string) =>
      metadata.findColumnWithPropertyName(property)!.databaseName;
    const collation = ['mysql', 'mariadb'].includes(runner.connection.options.type)
      ? 'utf8mb4_bin'
      : runner.connection.options.type === 'postgres'
        ? 'C'
        : 'BINARY';
    await runner.addColumns(ticket.tablePath, [
      new TableColumn({
        name: name(ticket, 'accountType'),
        type: 'varchar',
        length: '255',
        isNullable: true,
        collation,
      }),
      new TableColumn({
        name: name(ticket, 'accountId'),
        type: 'varchar',
        length: '255',
        isNullable: true,
        collation,
      }),
      new TableColumn({
        name: name(ticket, 'ticketType'),
        type: 'varchar',
        length: '50',
        isNullable: true,
        default: "'question'",
      }),
    ]);
    await runner.createIndex(
      ticket.tablePath,
      new TableIndex({
        name: 'IDX_escalated_ticket_account',
        columnNames: [name(ticket, 'accountType'), name(ticket, 'accountId')],
      }),
    );
    await runner.addColumns(sla.tablePath, [
      new TableColumn({ name: name(sla, 'departmentId'), type: 'int', isNullable: true }),
      new TableColumn({
        name: name(sla, 'ticketType'),
        type: 'varchar',
        length: '50',
        isNullable: true,
      }),
    ]);
    await runner.createIndex(
      sla.tablePath,
      new TableIndex({
        name: 'IDX_escalated_sla_department',
        columnNames: [name(sla, 'departmentId')],
      }),
    );
    await runner.createIndex(
      sla.tablePath,
      new TableIndex({ name: 'IDX_escalated_sla_type', columnNames: [name(sla, 'ticketType')] }),
    );
    await runner.createForeignKey(
      sla.tablePath,
      new TableForeignKey({
        name: 'FK_escalated_sla_department',
        columnNames: [name(sla, 'departmentId')],
        referencedTableName: department.tablePath,
        referencedColumnNames: department.primaryColumns.map((column) => column.databaseName),
        onDelete: 'RESTRICT',
      }),
    );
    await runner.addColumn(
      rule.tablePath,
      new TableColumn({ name: name(rule, 'conditions'), type: 'text', isNullable: true }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const ticket = runner.connection.getMetadata('Ticket');
    const sla = runner.connection.getMetadata('SlaPolicy');
    const rule = runner.connection.getMetadata('EscalationRule');
    await runner.dropForeignKey(sla.tablePath, 'FK_escalated_sla_department');
    await runner.dropIndex(ticket.tablePath, 'IDX_escalated_ticket_account');
    await runner.dropIndex(sla.tablePath, 'IDX_escalated_sla_department');
    await runner.dropIndex(sla.tablePath, 'IDX_escalated_sla_type');
    for (const [metadata, fields] of [
      [ticket, ['accountType', 'accountId', 'ticketType']],
      [sla, ['departmentId', 'ticketType']],
      [rule, ['conditions']],
    ] as const) {
      for (const field of fields)
        await runner.dropColumn(
          metadata.tablePath,
          metadata.findColumnWithPropertyName(field)!.databaseName,
        );
    }
  }
}
