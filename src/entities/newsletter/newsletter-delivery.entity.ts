import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Newsletter } from './newsletter.entity';
import { Contact } from '../contact.entity';

export type NewsletterDeliveryStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'bounced'
  | 'complained'
  | 'suppressed'
  | 'failed';

@Entity('escalated_newsletter_deliveries')
@Index(['newsletter_id', 'status'])
@Index(['status', 'claimed_at'])
export class NewsletterDelivery {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column()
  newsletter_id: number;

  @Index()
  @Column()
  contact_id: number;

  @Column({ length: 320 })
  email_at_send: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: NewsletterDeliveryStatus;

  @Column({ length: 40, unique: true })
  tracking_token: string;

  @Column({ type: 'datetime', nullable: true })
  sent_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  opened_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  last_clicked_at: Date | null;

  @Column({ default: 0 })
  clicks_count: number;

  @Column({ type: 'text', nullable: true })
  bounce_reason: string | null;

  @Column({ type: 'text', nullable: true })
  failure_reason: string | null;

  @Column({ type: 'smallint', default: 0 })
  attempt_count: number;

  @Column({ type: 'datetime', nullable: true })
  claimed_at: Date | null;

  @Column({ default: false })
  is_test: boolean;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Newsletter, (n) => n.deliveries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'newsletter_id' })
  newsletter: Newsletter;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;
}
