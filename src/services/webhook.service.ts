import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { Webhook } from '../entities/webhook.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { ESCALATED_EVENTS, WebhookEvent } from '../events/escalated.events';

@Injectable()
export class WebhookService {
  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
  ) {}

  async findAll(): Promise<Webhook[]> {
    return this.webhookRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findById(id: number): Promise<Webhook> {
    const webhook = await this.webhookRepo.findOne({
      where: { id },
      relations: ['deliveries'],
    });
    if (!webhook) throw new NotFoundException(`Webhook #${id} not found`);
    return webhook;
  }

  async create(data: Partial<Webhook>): Promise<Webhook> {
    if (!data.secret) {
      data.secret = crypto.randomBytes(32).toString('hex');
    }
    const webhook = this.webhookRepo.create(data);
    return this.webhookRepo.save(webhook);
  }

  async update(id: number, data: Partial<Webhook>): Promise<Webhook> {
    await this.findById(id);
    await this.webhookRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const webhook = await this.findById(id);
    await this.webhookRepo.remove(webhook);
  }

  @OnEvent('escalated.**')
  async handleEscalatedEvent(event: any): Promise<void> {
    // Determine event name from the emitted event
    const eventName = this.resolveEventName(event);
    if (!eventName) return;

    const webhooks = await this.webhookRepo.find({
      where: { isActive: true },
    });

    for (const webhook of webhooks) {
      if (webhook.events.includes(eventName) || webhook.events.includes('*')) {
        await this.dispatch(webhook, eventName, event);
      }
    }
  }

  async dispatch(webhook: Webhook, eventName: string, payload: any): Promise<WebhookDelivery> {
    const payloadStr = JSON.stringify({ event: eventName, data: payload, timestamp: new Date() });
    const signature = this.sign(payloadStr, webhook.secret);

    const delivery = await this.deliveryRepo.save({
      webhookId: webhook.id,
      event: eventName,
      payload: payloadStr,
      status: 'pending',
    });

    // Attempt delivery
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Escalated-Signature': signature,
          'X-Escalated-Event': eventName,
        },
        body: payloadStr,
        signal: AbortSignal.timeout(10000),
      });

      delivery.responseStatus = response.status;
      delivery.responseBody = await response.text().catch(() => '');
      delivery.status = response.ok ? 'success' : 'failed';
      delivery.attempts = 1;

      if (response.ok) {
        await this.webhookRepo.update(webhook.id, {
          failureCount: 0,
          lastDeliveredAt: new Date(),
        });
      } else {
        await this.webhookRepo.update(webhook.id, {
          failureCount: () => 'failureCount + 1',
        });
        delivery.nextRetryAt = new Date(Date.now() + 60000); // Retry in 1 minute
      }
    } catch (error) {
      delivery.status = 'failed';
      delivery.responseBody = error instanceof Error ? error.message : 'Unknown error';
      delivery.attempts = 1;
      delivery.nextRetryAt = new Date(Date.now() + 60000);

      await this.webhookRepo.update(webhook.id, {
        failureCount: () => 'failureCount + 1',
      });
    }

    return this.deliveryRepo.save(delivery);
  }

  async retryFailedDeliveries(maxRetries: number = 3): Promise<void> {
    const failed = await this.deliveryRepo
      .createQueryBuilder('delivery')
      .where('delivery.status = :status', { status: 'failed' })
      .andWhere('delivery.attempts < :maxRetries', { maxRetries })
      .andWhere('delivery.nextRetryAt <= :now', { now: new Date() })
      .getMany();

    for (const delivery of failed) {
      const webhook = await this.webhookRepo.findOne({ where: { id: delivery.webhookId } });
      if (!webhook || !webhook.isActive) continue;

      try {
        const signature = this.sign(delivery.payload, webhook.secret);
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Escalated-Signature': signature,
            'X-Escalated-Event': delivery.event,
          },
          body: delivery.payload,
          signal: AbortSignal.timeout(10000),
        });

        delivery.responseStatus = response.status;
        delivery.responseBody = await response.text().catch(() => '');
        delivery.status = response.ok ? 'success' : 'failed';
        delivery.attempts += 1;

        if (!response.ok && delivery.attempts < maxRetries) {
          // Exponential backoff
          delivery.nextRetryAt = new Date(Date.now() + Math.pow(2, delivery.attempts) * 60000);
        }
      } catch (error) {
        delivery.attempts += 1;
        delivery.responseBody = error instanceof Error ? error.message : 'Unknown error';
        if (delivery.attempts < maxRetries) {
          delivery.nextRetryAt = new Date(Date.now() + Math.pow(2, delivery.attempts) * 60000);
        }
      }

      await this.deliveryRepo.save(delivery);
    }
  }

  getDeliveries(webhookId: number): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({
      where: { webhookId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  private sign(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private resolveEventName(event: any): string | null {
    if (event?.constructor?.name === 'TicketCreatedEvent') return 'ticket.created';
    if (event?.constructor?.name === 'TicketUpdatedEvent') return 'ticket.updated';
    if (event?.constructor?.name === 'TicketAssignedEvent') return 'ticket.assigned';
    if (event?.constructor?.name === 'TicketStatusChangedEvent') return 'ticket.status_changed';
    if (event?.constructor?.name === 'TicketReplyCreatedEvent') return 'ticket.reply_created';
    if (event?.constructor?.name === 'TicketMergedEvent') return 'ticket.merged';
    if (event?.constructor?.name === 'TicketSplitEvent') return 'ticket.split';
    if (event?.constructor?.name === 'SlaBreachedEvent') return 'sla.breached';
    return null;
  }
}
