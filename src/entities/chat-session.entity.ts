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

  @Column({ type: Date, nullable: true })
  acceptedAt: Date;

  @Column({ type: Date, nullable: true })
  endedAt: Date;

  @Column({ type: Date })
  lastActivityAt: Date;

  /**
   * SHA-256 of the token the widget visitor uses to reach this chat. The token
   * itself is only returned once, when the chat starts.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  visitorTokenHash: string | null;

  /**
   * When the visitor token stops working (`guestAccess.ttlMinutes` after the
   * chat starts). Null only for chats started before tokens expired; the next
   * request with such a token gives it a full lifetime.
   */
  @Column({ type: Date, nullable: true })
  visitorTokenExpiresAt: Date | null;

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
