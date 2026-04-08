import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SideConversation } from './side-conversation.entity';

@Entity('escalated_side_conversation_replies')
export class SideConversationReply {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SideConversation, (sc) => sc.replies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sideConversationId' })
  sideConversation: SideConversation;

  @Column()
  sideConversationId: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn()
  createdAt: Date;
}
