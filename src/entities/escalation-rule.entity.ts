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

@Entity('escalated_escalation_rules')
export class EscalationRule {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SlaPolicy, (sla) => sla.escalationRules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slaPolicyId' })
  slaPolicy: SlaPolicy;

  @Column()
  slaPolicyId: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 50 })
  triggerType: string; // first_response_breach, resolution_breach, approaching_breach

  @Column({ type: 'int', default: 0 })
  minutesBefore: number; // minutes before breach (for approaching)

  @Column({ type: 'simple-json' })
  actions: Record<string, any>[]; // [{type: 'reassign', value: userId}, {type: 'notify', value: email}]

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
