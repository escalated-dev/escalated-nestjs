import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';

@Entity('escalated_ticket_activities')
export class TicketActivity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @Column()
  ticketId: number;

  @Column({ type: 'int', nullable: true })
  userId: number;

  @Column({ length: 100 })
  action: string; // created, assigned, status_changed, priority_changed, merged, split, etc.

  @Column({ type: 'simple-json', nullable: true })
  oldValue: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  newValue: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}
