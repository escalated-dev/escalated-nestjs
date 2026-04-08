import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { EscalationRule } from './escalation-rule.entity';

@Entity('escalated_sla_policies')
export class SlaPolicy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isDefault: boolean;

  // Priority-based targets in minutes
  @Column({ type: 'int', default: 60 })
  firstResponseLow: number;

  @Column({ type: 'int', default: 30 })
  firstResponseMedium: number;

  @Column({ type: 'int', default: 15 })
  firstResponseHigh: number;

  @Column({ type: 'int', default: 5 })
  firstResponseUrgent: number;

  @Column({ type: 'int', default: 1440 })
  resolutionLow: number;

  @Column({ type: 'int', default: 480 })
  resolutionMedium: number;

  @Column({ type: 'int', default: 240 })
  resolutionHigh: number;

  @Column({ type: 'int', default: 60 })
  resolutionUrgent: number;

  // Conditions for auto-matching
  @Column({ type: 'simple-json', nullable: true })
  conditions: Record<string, any>;

  @Column({ type: 'int', nullable: true })
  businessScheduleId: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @OneToMany(() => EscalationRule, (rule) => rule.slaPolicy)
  escalationRules: EscalationRule[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
