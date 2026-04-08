import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinTable,
  JoinColumn,
  Index,
} from 'typeorm';
import { TicketStatus } from './ticket-status.entity';
import { Department } from './department.entity';
import { Tag } from './tag.entity';

@Entity('escalated_tickets')
@Index(['referenceNumber'], { unique: true })
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 20, unique: true })
  referenceNumber: string;

  @Column({ length: 500 })
  subject: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ length: 20, default: 'medium' })
  priority: string; // low, medium, high, urgent

  @Column({ length: 50, default: 'web' })
  channel: string; // web, email, api, widget

  @ManyToOne(() => TicketStatus, { eager: true, nullable: true })
  @JoinColumn({ name: 'statusId' })
  status: TicketStatus;

  @Column({ nullable: true })
  statusId: number;

  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  @Column({ nullable: true })
  departmentId: number;

  // Requester (customer) - generic user ID from host app
  @Column({ type: 'int' })
  requesterId: number;

  // Assigned agent - generic user ID from host app
  @Column({ type: 'int', nullable: true })
  assigneeId: number;

  @ManyToMany(() => Tag)
  @JoinTable({
    name: 'escalated_ticket_tags',
    joinColumn: { name: 'ticketId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tagId', referencedColumnName: 'id' },
  })
  tags: Tag[];

  // SLA tracking
  @Column({ type: 'int', nullable: true })
  slaPolicyId: number;

  @Column({ type: 'datetime', nullable: true })
  firstResponseDueAt: Date;

  @Column({ type: 'datetime', nullable: true })
  resolutionDueAt: Date;

  @Column({ type: 'datetime', nullable: true })
  firstRespondedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date;

  @Column({ default: false })
  slaBreached: boolean;

  // Snooze
  @Column({ type: 'datetime', nullable: true })
  snoozedUntil: Date;

  // Merge tracking
  @Column({ type: 'int', nullable: true })
  mergedIntoTicketId: number;

  @Column({ default: false })
  isMerged: boolean;

  // Guest access
  @Column({ length: 255, nullable: true })
  guestAccessToken: string;

  // CSAT
  @Column({ type: 'int', nullable: true })
  satisfactionRatingId: number;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
