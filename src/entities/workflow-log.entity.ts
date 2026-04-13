import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  AfterLoad,
} from 'typeorm';
import { Workflow } from './workflow.entity';
import { Ticket } from './ticket.entity';

@Entity('escalated_workflow_logs')
export class WorkflowLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Workflow, { eager: false })
  @JoinColumn({ name: 'workflow_id' })
  workflow: Workflow;

  @ManyToOne(() => Ticket, { eager: false })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ length: 255 })
  triggerEvent: string;

  @Column({ default: true })
  conditionsMatched: boolean;

  @Column({ type: 'simple-json', default: '[]' })
  actionsExecutedRaw: Array<Record<string, unknown>>;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'datetime', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  // --- Computed fields expected by the frontend ---

  event: string;
  workflowName: string | null;
  ticketReference: string | null;
  matched: boolean;
  actionsExecuted: number;
  actionDetails: Array<Record<string, unknown>>;
  durationMs: number | null;
  status: string;

  @AfterLoad()
  computeFields() {
    this.event = this.triggerEvent;
    this.matched = this.conditionsMatched;
    this.actionDetails = this.actionsExecutedRaw || [];
    this.actionsExecuted = this.actionDetails.length;
    this.status = this.errorMessage ? 'failed' : 'success';
    this.workflowName = this.workflow?.name ?? null;
    this.ticketReference = (this.ticket as any)?.referenceNumber ?? null;

    if (this.startedAt && this.completedAt) {
      this.durationMs = new Date(this.completedAt).getTime() - new Date(this.startedAt).getTime();
    } else {
      this.durationMs = null;
    }
  }
}
