import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  AfterLoad,
} from 'typeorm';
import { Reply } from './reply.entity';

@Entity('escalated_attachments')
export class Attachment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Reply, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'replyId' })
  reply: Reply;

  @Column({ nullable: true })
  replyId: number;

  @Column({ type: 'int', nullable: true })
  ticketId: number;

  @Column({ length: 255 })
  fileName: string;

  @Column({ length: 255 })
  filePath: string;

  @Column({ length: 100 })
  mimeType: string;

  @Column({ type: 'int' })
  fileSize: number;

  @CreateDateColumn()
  createdAt: Date;

  /** Virtual field populated after entity load */
  url: string;

  @AfterLoad()
  setUrl() {
    this.url = `/escalated/attachments/${this.id}/download`;
  }
}
