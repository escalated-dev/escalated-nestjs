import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * When a customer was last seen by the customer portal or the widget (ADR
 * 2026-11-05-agent-panel-data, section 2). The subject is a ticket's requester
 * (`user`, the host user id) or, for a guest, its contact (`contact`). Only
 * staff pages ever show it.
 */
@Entity('escalated_customer_presence')
@Index(['subjectType', 'subjectId'], { unique: true })
export class CustomerPresence {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  subjectType: string;

  /** A string, so it holds integer, UUID and string user keys alike. */
  @Column({ type: 'varchar', length: 64 })
  subjectId: string;

  @Column({ type: Date })
  lastSeenAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
