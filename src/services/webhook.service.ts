import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { Webhook } from '../entities/webhook.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { assertPublicWebhookUrl, UnsafeWebhookUrlError } from './webhook-url-safety';
import { canonicalEvents } from '../events/event-names';

/**
 * Event class name to the webhook event name (ADR 2026-10-21). Merged and split
 * tickets are sent as well; they are not in the shared vocabulary yet.
 */
const WEBHOOK_EVENT_NAMES: Readonly<Record<string, string>> = {
  TicketCreatedEvent: 'ticket.created',
  TicketUpdatedEvent: 'ticket.updated',
  TicketStatusChangedEvent: 'ticket.status_changed',
  TicketResolvedEvent: 'ticket.resolved',
  TicketClosedEvent: 'ticket.closed',
  TicketReopenedEvent: 'ticket.reopened',
  TicketAssignedEvent: 'ticket.assigned',
  TicketUnassignedEvent: 'ticket.unassigned',
  TicketEscalatedEvent: 'ticket.escalated',
  TicketPriorityChangedEvent: 'ticket.priority_changed',
  TicketDepartmentChangedEvent: 'ticket.department_changed',
  TicketTagAddedEvent: 'ticket.tag_added',
  TicketTagRemovedEvent: 'ticket.tag_removed',
  TicketReplyCreatedEvent: 'reply.created',
  NoteCreatedEvent: 'note.created',
  SlaWarningEvent: 'sla.warning',
  SlaBreachedEvent: 'sla.breached',
  ChatStartedEvent: 'chat.started',
  ChatAssignedEvent: 'chat.assigned',
  ChatTransferredEvent: 'chat.transferred',
  ChatMessageEvent: 'chat.message',
  ChatEndedEvent: 'chat.ended',
  TicketMergedEvent: 'ticket.merged',
  TicketSplitEvent: 'ticket.split',
};

/**
 * The name `event` goes out under (webhooks, plugin actions), or null. An
 * internal note goes out as `note.created` (NoteCreatedEvent), never as a reply.
 */
export function webhookEventName(event: any): string | null {
  const name = WEBHOOK_EVENT_NAMES[event?.constructor?.name] ?? null;
  if (name === 'reply.created' && event.reply?.isInternal) return null;
  return name;
}

/** Every event name webhooks are sent under, in the shared vocabulary's order. */
export function webhookEventNames(): string[] {
  return [...new Set(Object.values(WEBHOOK_EVENT_NAMES))];
}

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
      relations: { deliveries: true },
    });
    if (!webhook) throw new NotFoundException(`Webhook #${id} not found`);
    return webhook;
  }

  async create(data: Partial<Webhook>): Promise<Webhook> {
    await this.assertSavableUrl(data.url);
    if (data.events !== undefined) data.events = canonicalEvents(data.events);
    if (!data.secret) {
      data.secret = crypto.randomBytes(32).toString('hex');
    }
    const webhook = this.webhookRepo.create(data);
    return this.webhookRepo.save(webhook);
  }

  async update(id: number, data: Partial<Webhook>): Promise<Webhook> {
    await this.findById(id);
    if (data.url !== undefined) {
      await this.assertSavableUrl(data.url);
    }
    if (data.events !== undefined) data.events = canonicalEvents(data.events);
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
      const subscribed = Array.isArray(webhook.events) ? webhook.events : [];
      // Stored legacy names (`ticket.reply_created`, `ticket.tagged`, ...) read as canonical.
      if (subscribed.includes('*') || canonicalEvents(subscribed).includes(eventName)) {
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
      // Checked again at send time: DNS may have changed since the URL was saved.
      await assertPublicWebhookUrl(webhook.url);
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Escalated-Signature': signature,
          'X-Escalated-Event': eventName,
        },
        body: payloadStr,
        // A redirect could lead to an address the check above refuses.
        redirect: 'manual',
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
        await assertPublicWebhookUrl(webhook.url);
        const signature = this.sign(delivery.payload, webhook.secret);
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Escalated-Signature': signature,
            'X-Escalated-Event': delivery.event,
          },
          body: delivery.payload,
          redirect: 'manual',
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

  /**
   * Sends one stored delivery again now, whatever its status, as the admin's
   * Retry button asks (escalated-laravel's `retryDelivery`). Counts the attempt.
   */
  async retryDelivery(deliveryId: number): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundException(`Webhook delivery #${deliveryId} not found`);
    const webhook = await this.webhookRepo.findOne({ where: { id: delivery.webhookId } });
    if (!webhook) throw new NotFoundException(`Webhook #${delivery.webhookId} not found`);

    delivery.attempts = (delivery.attempts ?? 0) + 1;
    try {
      await assertPublicWebhookUrl(webhook.url);
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Escalated-Signature': this.sign(delivery.payload, webhook.secret),
          'X-Escalated-Event': delivery.event,
        },
        body: delivery.payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      delivery.responseStatus = response.status;
      delivery.responseBody = await response.text().catch(() => '');
      delivery.status = response.ok ? 'success' : 'failed';
    } catch (error) {
      delivery.status = 'failed';
      delivery.responseStatus = null as unknown as number;
      delivery.responseBody = error instanceof Error ? error.message : 'Unknown error';
    }
    if (delivery.status === 'success') {
      await this.webhookRepo.update(webhook.id, { failureCount: 0, lastDeliveredAt: new Date() });
    }
    return this.deliveryRepo.save(delivery);
  }

  getDeliveries(webhookId: number): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({
      where: { webhookId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Rejects a URL that is not http(s) or does not resolve only to public addresses. */
  private async assertSavableUrl(url: string | undefined): Promise<void> {
    try {
      await assertPublicWebhookUrl(url as string);
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private sign(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private resolveEventName(event: any): string | null {
    return webhookEventName(event);
  }
}
