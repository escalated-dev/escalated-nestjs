import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Ticket } from './ticket.entity';
import { SideConversationReply } from './side-conversation-reply.entity';

@Entity('escalated_side_conversations')
export class SideConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @Column()
  ticketId: number;

  @Column({ length: 500 })
  subject: string;

  @Column({ type: 'int' })
  createdBy: number;

  @Column({ type: 'simple-json', nullable: true })
  participants: number[]; // user IDs

  @Column({ length: 20, default: 'open' })
  status: string; // open, closed

  @OneToMany(() => SideConversationReply, (r) => r.sideConversation)
  replies: SideConversationReply[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
