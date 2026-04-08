import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Department } from './department.entity';

@Entity('escalated_chat_routing_rules')
export class ChatRoutingRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'int', nullable: true })
  departmentId: number;

  @Column({ type: 'int', nullable: true })
  agentId: number;

  @Column({ type: 'text', nullable: true })
  conditions: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ default: true })
  isActive: boolean;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
