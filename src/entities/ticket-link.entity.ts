import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';

@Entity('escalated_ticket_links')
export class TicketLink {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @Column()
  ticketId: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'linkedTicketId' })
  linkedTicket: Ticket;

  @Column()
  linkedTicketId: number;

  @Column({ length: 50, default: 'related' })
  linkType: string; // related, blocks, blocked_by, duplicate

  @CreateDateColumn()
  createdAt: Date;
}
