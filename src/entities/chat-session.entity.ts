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
import { userIdColumn, UserId } from '../config/user-id-column';

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

  @Column(userIdColumn({ nullable: true }))
  agentId: UserId | null;

  @Column({ type: 'int', nullable: true })
  departmentId: number;

  @Column({ length: 30, default: 'waiting' })
  status: string; // waiting, active, ended

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  endedAt: Date;

  @Column({ type: 'timestamp' })
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
