import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { userIdColumn, UserId } from '../config/user-id-column';

/**
 * An in-app notification for an agent (ADR 2026-11-05-agent-panel-data,
 * section 4). `data` holds the ticket id and reference and whatever the title
 * needs; the ticket id is deliberately not a column, so a ticket the agent can
 * no longer see redacts the item instead of hiding it.
 */
@Entity('escalated_notifications')
@Index(['userId', 'readAt'])
export class AgentNotification {
  /** A UUID, as Laravel's notification ids. */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column(userIdColumn())
  userId: UserId;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'simple-json' })
  data: Record<string, unknown>;

  @Column({ type: Date, nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
