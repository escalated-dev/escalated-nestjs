import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { userIdColumn, UserId } from '../config/user-id-column';

/** escalated-laravel's import state machine. */
export const IMPORT_TRANSITIONS: Record<string, string[]> = {
  pending: ['authenticating'],
  authenticating: ['mapping', 'failed'],
  mapping: ['importing', 'failed'],
  importing: ['paused', 'completed', 'failed'],
  paused: ['importing', 'failed'],
  completed: [],
  failed: ['mapping'],
};

/**
 * One import from an external platform, as escalated-laravel's ImportJob: its
 * status, per-entity progress and cursors, error log and the source
 * credentials (sealed by ImportCredentials), which are dropped when the
 * import completes or is cancelled.
 */
@Entity('escalated_import_jobs')
export class ImportJob {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column(userIdColumn({ nullable: true }))
  userId: UserId | null;

  @Column({ type: 'varchar', length: 50 })
  platform: string;

  @Index()
  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status: string;

  /** Sealed; never serialised to a page. */
  @Column({ type: 'text', nullable: true, select: true })
  credentials: string | null;

  @Column({ type: 'simple-json', nullable: true })
  fieldMappings: Record<string, unknown> | null;

  @Column({ type: 'simple-json', nullable: true })
  progress: Record<string, Record<string, unknown>> | null;

  @Column({ type: 'simple-json', nullable: true })
  errorLog: Array<Record<string, unknown>> | null;

  @Column({ type: Date, nullable: true })
  startedAt: Date | null;

  @Column({ type: Date, nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  assignId() {
    if (!this.id) this.id = randomUUID();
  }

  transitionTo(next: string) {
    if (!(IMPORT_TRANSITIONS[this.status] ?? []).includes(next)) {
      throw new Error(`Cannot transition from '${this.status}' to '${next}'.`);
    }
    this.status = next;
  }

  get resumable(): boolean {
    return this.status === 'paused' || this.status === 'failed';
  }

  /** Never serializes the sealed credentials; the import run reads them server-side. */
  toJSON() {
    const { credentials: _credentials, ...rest } = this;
    return rest;
  }
}
