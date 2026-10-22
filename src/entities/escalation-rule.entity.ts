import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SlaPolicy } from './sla-policy.entity';

/**
 * An admin escalation rule, as escalated-laravel's EscalationRule: a list of
 * conditions (`[{ field, value }]`) matched against open tickets and a list of
 * actions (`[{ type, value }]`) run on each match, once per ticket (see
 * RuleFireLog).
 *
 * Rules saved before 1.3 keep their earlier shape (an SLA policy, an SLA
 * `triggerType`, and `conditions` as an object) and are read through
 * `normalizeEscalationRule`, which turns that shape into conditions.
 */
@Entity('escalated_escalation_rules')
export class EscalationRule {
  /** `[{ field, value }]`; an object on rules saved before 1.3. */
  @Column({ type: 'simple-json', nullable: true })
  conditions: Array<{ field: string; value: unknown }> | Record<string, unknown> | null;

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SlaPolicy, (sla) => sla.escalationRules, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'slaPolicyId' })
  slaPolicy: SlaPolicy | null;

  /** Only rules saved before 1.3 have one; it limits the rule to that policy's tickets. */
  @Column({ type: 'int', nullable: true })
  slaPolicyId: number | null;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * A label on rules from the admin form (`time_based`, `sla_breach`,
   * `priority_based`). On rules saved before 1.3 it is the SLA trigger
   * (`first_response_breach`, `resolution_breach`, `approaching_breach`).
   */
  @Column({ length: 50 })
  triggerType: string;

  /** Minutes before the deadline, for the `approaching_breach` trigger. */
  @Column({ type: 'int', default: 0 })
  minutesBefore: number;

  /** `[{ type, value }]`: `escalate`, `change_priority`, `assign_to`, `change_department`. */
  @Column({ type: 'simple-json' })
  actions: Record<string, any>[];

  @Column({ default: true })
  isActive: boolean;

  /** Laravel's `order`. */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  /** Null fires once per ticket; a number lets the rule fire again that many hours later. */
  @Column({ type: 'int', nullable: true })
  repeatAfterHours: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
