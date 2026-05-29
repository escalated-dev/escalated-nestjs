import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SideConversation } from './side-conversation.entity';
import { userIdColumn, UserId } from '../config/user-id-column';

@Entity('escalated_side_conversation_replies')
export class SideConversationReply {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SideConversation, (sc) => sc.replies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sideConversationId' })
  sideConversation: SideConversation;

  @Column()
  sideConversationId: number;

  @Column(userIdColumn())
  userId: UserId;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn()
  createdAt: Date;
}
