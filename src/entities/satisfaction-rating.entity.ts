import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';
import { userIdColumn, UserId } from '../config/user-id-column';

@Entity('escalated_satisfaction_ratings')
export class SatisfactionRating {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @Column()
  ticketId: number;

  @Column(userIdColumn())
  customerId: UserId;

  @Column(userIdColumn({ nullable: true }))
  agentId: UserId | null;

  @Column({ type: 'int' })
  rating: number; // 1-5

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ length: 100, nullable: true })
  ratingToken: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
