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

  /** Signs deliveries; never serialized. Responses carry `has_secret` instead. */
  @Column({ length: 255 })
  secret: string;

  @Column({ type: 'simple-json' })
  events: string[]; // ['ticket.created', 'ticket.updated', ...]

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  failureCount: number;

  @Column({ type: Date, nullable: true })
  lastDeliveredAt: Date;

  @OneToMany(() => WebhookDelivery, (d) => d.webhook)
  deliveries: WebhookDelivery[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** The JSON API's shape: everything but the signing secret, and whether one is set. */
  toJSON() {
    const { secret: _secret, ...rest } = this;
    return { ...rest, has_secret: !!this.secret };
  }
}
