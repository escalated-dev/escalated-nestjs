import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  AfterLoad,
} from 'typeorm';
import { WorkflowLog } from './workflow-log.entity';

@Entity('escalated_workflows')
export class Workflow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 255 })
  triggerEvent: string;

  @Column({ type: 'simple-json', default: '{}' })
  conditions: Record<string, unknown>;

  @Column({ type: 'simple-json', default: '[]' })
  actions: Array<Record<string, unknown>>;

  @Column({ default: 0 })
  position: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  stopOnMatch: boolean;

  @OneToMany(() => WorkflowLog, (log) => log.workflow)
  workflowLogs: WorkflowLog[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Alias for frontend compatibility: the frontend uses `trigger` instead of `trigger_event`. */
  trigger: string;

  @AfterLoad()
  computeFields() {
    this.trigger = this.triggerEvent;
  }
}
