import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';
import { userIdColumnType } from '../config/user-id-column';

/**
 * The agent panel's data (ADR 2026-11-05-agent-panel-data):
 *
 * - `escalated_tickets.lastCustomerActivityAt` (indexed) and the
 *   `escalated_ticket_reads` table, for per-agent unread markers. Existing
 *   tickets keep a null activity, so none of them turn unread on upgrade.
 * - `escalated_customer_presence`, when each customer was last seen.
 * - `escalated_agent_profiles.chatStatus` (online / away / offline), set from
 *   `isAvailable` for existing agents.
 * - `escalated_notifications`, the agents' in-app notifications.
 *
 * Register with the host DataSource and run before upgrading.
 */
export class AgentPanelData1793664000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const n = this.names(runner);
    const userType = String(userIdColumnType());
    const userLength = userType === 'varchar' ? '255' : undefined;
    const reads = (p: string) => n.col('TicketRead', p);
    const presence = (p: string) => n.col('CustomerPresence', p);
    const notes = (p: string) => n.col('AgentNotification', p);

    await runner.addColumn(
      n.tickets,
      new TableColumn({ name: n.activity, type: n.timestamp, isNullable: true }),
    );
    await runner.createIndex(
      n.tickets,
      new TableIndex({ name: n.index('activity'), columnNames: [n.activity] }),
    );

    await runner.createTable(
      new Table({
        name: n.reads,
        columns: [
          n.id(reads('id')),
          { name: reads('userId'), type: userType, length: userLength },
          { name: reads('ticketId'), type: 'integer' },
          { name: reads('lastReadAt'), type: n.timestamp, isNullable: true },
          ...n.timestamps(reads),
        ],
        indices: [
          {
            name: n.index('reads_user_ticket'),
            columnNames: [reads('userId'), reads('ticketId')],
            isUnique: true,
          },
          { name: n.index('reads_ticket'), columnNames: [reads('ticketId')] },
        ],
        foreignKeys: [
          {
            columnNames: [reads('ticketId')],
            referencedTableName: n.tickets,
            referencedColumnNames: [n.ticketId],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await runner.createTable(
      new Table({
        name: n.presence,
        columns: [
          n.id(presence('id')),
          { name: presence('subjectType'), type: 'varchar', length: '32' },
          { name: presence('subjectId'), type: 'varchar', length: '64' },
          { name: presence('lastSeenAt'), type: n.timestamp },
          ...n.timestamps(presence),
        ],
        indices: [
          {
            name: n.index('presence_subject'),
            columnNames: [presence('subjectType'), presence('subjectId')],
            isUnique: true,
          },
        ],
      }),
    );

    const status = n.col('AgentProfile', 'chatStatus');
    await runner.addColumn(
      n.profiles,
      new TableColumn({ name: status, type: 'varchar', length: '16', default: "'offline'" }),
    );
    const e = (value: string) => runner.connection.driver.escape(value);
    await runner.query(
      `UPDATE ${e(n.profiles)} SET ${e(status)} = 'online' WHERE ${e(n.col('AgentProfile', 'isAvailable'))} = ${n.true}`,
    );

    await runner.createTable(
      new Table({
        name: n.notifications,
        columns: [
          { name: notes('id'), type: 'varchar', length: '36', isPrimary: true },
          { name: notes('userId'), type: userType, length: userLength },
          { name: notes('type'), type: 'varchar', length: '64' },
          { name: notes('data'), type: 'text' },
          { name: notes('readAt'), type: n.timestamp, isNullable: true },
          { name: notes('createdAt'), type: n.timestamp, default: n.now },
        ],
        indices: [
          { name: n.index('notifications_user'), columnNames: [notes('userId'), notes('readAt')] },
        ],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const n = this.names(runner);
    await runner.dropTable(n.notifications, true);
    await runner.dropColumn(n.profiles, n.col('AgentProfile', 'chatStatus'));
    await runner.dropTable(n.presence, true);
    await runner.dropTable(n.reads, true);
    await runner.dropIndex(n.tickets, n.index('activity'));
    await runner.dropColumn(n.tickets, n.activity);
  }

  private names(runner: QueryRunner) {
    const connection = runner.connection;
    const type = connection.options.type;
    const prefix = connection.options.entityPrefix ?? '';
    const col = (entity: string, property: string) =>
      (connection.hasMetadata(entity)
        ? connection.getMetadata(entity).findColumnWithPropertyName(property)?.databaseName
        : undefined) ?? property;
    const table = (entity: string, fallback: string) =>
      connection.hasMetadata(entity)
        ? connection.getMetadata(entity).tablePath
        : `${prefix}${fallback}`;
    const timestamp = type === 'postgres' ? 'timestamp' : 'datetime';
    const now =
      type === 'postgres'
        ? 'now()'
        : type === 'mysql' || type === 'mariadb'
          ? 'CURRENT_TIMESTAMP'
          : "datetime('now')";
    return {
      tickets: table('Ticket', 'escalated_tickets'),
      ticketId: col('Ticket', 'id'),
      activity: col('Ticket', 'lastCustomerActivityAt'),
      profiles: table('AgentProfile', 'escalated_agent_profiles'),
      reads: table('TicketRead', 'escalated_ticket_reads'),
      presence: table('CustomerPresence', 'escalated_customer_presence'),
      notifications: table('AgentNotification', 'escalated_notifications'),
      timestamp,
      now,
      true: type === 'postgres' ? 'true' : '1',
      col,
      index: (suffix: string) => `IDX_${prefix}esc_panel_${suffix}`.slice(0, 63),
      id: (name: string) => ({
        name,
        type: 'integer',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment' as const,
      }),
      timestamps: (column: (property: string) => string) => [
        { name: column('createdAt'), type: timestamp, default: now },
        { name: column('updatedAt'), type: timestamp, default: now },
      ],
    };
  }
}
