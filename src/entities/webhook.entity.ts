import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { WebhookDelivery } from './webhook-delivery.entity';

@Entity('escalated_webhooks')
export class Webhook {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 500 })
  url: string;

  @Column({ length: 255 })
  secret: string;

  @Column({ type: 'simple-json' })
  events: string[]; // ['ticket.created', 'ticket.updated', ...]

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  failureCount: number;

  @Column({ type: 'datetime', nullable: true })
  lastDeliveredAt: Date;

  @OneToMany(() => WebhookDelivery, (d) => d.webhook)
  deliveries: WebhookDelivery[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
