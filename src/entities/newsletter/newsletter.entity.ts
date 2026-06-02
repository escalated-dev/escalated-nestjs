import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { NewsletterList } from './newsletter-list.entity';
import { NewsletterTemplate } from './newsletter-template.entity';
import { NewsletterDelivery } from './newsletter-delivery.entity';

export type NewsletterStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed';

@Entity('escalated_newsletters')
@Index(['status', 'scheduled_at'])
export class Newsletter {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 998 })
  subject: string;

  @Column({ length: 320 })
  from_email: string;

  @Column({ length: 255, nullable: true })
  from_name: string | null;

  @Column({ length: 320, nullable: true })
  reply_to: string | null;

  @Column()
  target_list_id: number;

  @Column({ type: 'int', nullable: true })
  template_id: number | null;

  @Column({ length: 64, nullable: true })
  theme: string | null;

  @Column({ type: 'text', nullable: true })
  body_markdown: string | null;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: NewsletterStatus;

  @Index()
  @Column({ type: 'datetime', nullable: true })
  scheduled_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  sent_at: Date | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @Column({ type: 'int', nullable: true })
  sent_by: number | null;

  @Column({ default: 0 })
  summary_total: number;

  @Column({ default: 0 })
  summary_sent: number;

  @Column({ default: 0 })
  summary_opened: number;

  @Column({ default: 0 })
  summary_clicked: number;

  @Column({ default: 0 })
  summary_bounced: number;

  @Column({ default: 0 })
  summary_complained: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => NewsletterList)
  @JoinColumn({ name: 'target_list_id' })
  targetList: NewsletterList;

  @ManyToOne(() => NewsletterTemplate, { nullable: true })
  @JoinColumn({ name: 'template_id' })
  template: NewsletterTemplate | null;

  @OneToMany(() => NewsletterDelivery, (d) => d.newsletter)
  deliveries: NewsletterDelivery[];
}
