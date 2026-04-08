import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('escalated_agent_capacities')
export class AgentCapacity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  agentProfileId: number;

  @Column({ type: 'int', default: 20 })
  maxTickets: number;

  @Column({ type: 'int', default: 0 })
  currentTickets: number;

  @Column({ type: 'int', default: 5 })
  maxUrgent: number;

  @Column({ type: 'int', default: 0 })
  currentUrgent: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
