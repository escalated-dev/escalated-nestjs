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

@Entity('escalated_ticket_subjects')
@Index(['ticketId', 'subjectType', 'subjectId'], { unique: true })
@Index(['subjectType', 'subjectId'])
export class TicketSubjectLink {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Ticket, (ticket) => ticket.subjects, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @Column()
  ticketId: number;

  @Column({ length: 255 })
  subjectType: string;

  @Column({ length: 255 })
  subjectId: string;

  @Column({ length: 255, nullable: true })
  role: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
