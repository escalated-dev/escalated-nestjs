import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { userIdColumn, UserId } from '../config/user-id-column';
import { Ticket } from './ticket.entity';

/**
 * When an agent last read a ticket (ADR 2026-11-05-agent-panel-data, section
 * 1). `lastReadAt` null means the agent marked the ticket unread. One row per
 * agent and ticket; rows go with the ticket.
 */
@Entity('escalated_ticket_reads')
@Index(['userId', 'ticketId'], { unique: true })
@Index(['ticketId'])
export class TicketRead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column(userIdColumn())
  userId: UserId;

  @Column({ type: 'int' })
  ticketId: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE', createForeignKeyConstraints: true })
  @JoinColumn({ name: 'ticketId' })
  ticket?: Ticket;

  @Column({ type: Date, nullable: true })
  lastReadAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
