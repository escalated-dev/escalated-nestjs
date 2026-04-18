import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Webhook } from './webhook.entity';

@Entity('escalated_webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Webhook, (w) => w.deliveries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'webhookId' })
  webhook: Webhook;

  @Column()
  webhookId: number;

  @Column({ length: 100 })
  event: string;

  @Column({ type: 'text' })
  payload: string;

  @Column({ type: 'int', nullable: true })
  responseStatus: number;

  @Column({ type: 'text', nullable: true })
  responseBody: string;

  @Column({ length: 20, default: 'pending' })
  status: string; // pending, success, failed

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  nextRetryAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
