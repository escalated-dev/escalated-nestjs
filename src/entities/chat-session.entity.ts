import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Ticket } from './ticket.entity';
import { Department } from './department.entity';

@Entity('escalated_chat_sessions')
@Index(['ticketId'])
@Index(['status'])
@Index(['agentId'])
export class ChatSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  @Column({ length: 255, default: 'Visitor' })
  visitorName: string;

  @Column({ length: 255, nullable: true })
  visitorEmail: string;

  @Column({ type: 'int', nullable: true })
  agentId: number;

  @Column({ type: 'int', nullable: true })
  departmentId: number;

  @Column({ length: 30, default: 'waiting' })
  status: string; // waiting, active, ended

  @Column({ type: 'datetime', nullable: true })
  acceptedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  endedAt: Date;

  @Column({ type: 'datetime' })
  lastActivityAt: Date;

  @ManyToOne(() => Ticket, { nullable: true })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
