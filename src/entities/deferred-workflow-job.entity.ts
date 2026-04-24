import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Queue row for a paused workflow run — populated by the
 * {@code delay} workflow action when execution hits a wait clause
 * and consumed by the poller in
 * {@see WorkflowExecutorService.runDueDeferredJobs} to resume.
 *
 * Rows are soft-terminal: the poller flips {@code status} to
 * {@code 'done'} (or {@code 'failed'}) after running so they don't
 * get re-picked up, and retains the row for audit.
 */
@Entity('escalated_deferred_workflow_jobs')
@Index(['status', 'runAt'])
export class DeferredWorkflowJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  /**
   * Remaining actions to run after the delay expires. Stored as a
   * JSON array mirroring the {@code WorkflowAction[]} shape.
   */
  @Column({ type: 'simple-json' })
  remainingActions: Array<{ type: string; value?: string }>;

  /** UTC timestamp after which the poller should pick this row up. */
  @Column({ type: 'datetime' })
  runAt: Date;

  /** `pending` | `done` | `failed` — soft state machine. */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
