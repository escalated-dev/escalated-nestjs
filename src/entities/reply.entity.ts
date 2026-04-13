import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';
import { Attachment } from './attachment.entity';

@Entity('escalated_replies')
export class Reply {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  @Column()
  ticketId: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'text' })
  body: string;

  @Column({ length: 20, default: 'reply' })
  type: string; // reply, note, system

  @Column({ default: false })
  isInternal: boolean;

  @Column({ length: 255, nullable: true })
  emailMessageId: string;

  @OneToMany(() => Attachment, (attachment) => attachment.reply, { eager: false })
  attachments: Attachment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
