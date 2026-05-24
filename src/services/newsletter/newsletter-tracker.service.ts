import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Newsletter, NewsletterDelivery } from '../../entities/newsletter';
import { BounceSuppressionStoreService } from './bounce-suppression-store.service';

@Injectable()
export class NewsletterTrackerService {
  constructor(
    @InjectRepository(Newsletter)
    private readonly newsletters: Repository<Newsletter>,
    @InjectRepository(NewsletterDelivery)
    private readonly deliveries: Repository<NewsletterDelivery>,
    private readonly bounces: BounceSuppressionStoreService,
  ) {}

  async recordOpen(token: string): Promise<void> {
    const d = await this.findByToken(token);
    if (!d) return;
    if (['bounced', 'complained', 'failed'].includes(d.status)) return;
    if (d.opened_at) return;
    await this.deliveries.update(d.id, { opened_at: new Date() });
    await this.newsletters.increment({ id: d.newsletter_id }, 'summary_opened', 1);
  }

  async recordClick(token: string, _url: string): Promise<void> {
    const d = await this.findByToken(token);
    if (!d) return;
    if (['bounced', 'complained', 'failed'].includes(d.status)) return;
    const isFirstClick = d.clicks_count === 0;
    await this.deliveries.update(d.id, {
      clicks_count: d.clicks_count + 1,
      last_clicked_at: new Date(),
    });
    if (!d.opened_at) {
      await this.deliveries.update(d.id, { opened_at: new Date() });
      await this.newsletters.increment({ id: d.newsletter_id }, 'summary_opened', 1);
    }
    if (isFirstClick) {
      await this.newsletters.increment({ id: d.newsletter_id }, 'summary_clicked', 1);
    }
  }

  async recordBounce(token: string, type: 'hard' | 'soft', reason?: string): Promise<void> {
    const d = await this.findByToken(token);
    if (!d) return;
    if (type !== 'hard') return;
    if (d.status === 'bounced') return;
    await this.deliveries.update(d.id, {
      status: 'bounced',
      bounce_reason: reason ?? null,
    });
    await this.newsletters.increment({ id: d.newsletter_id }, 'summary_bounced', 1);
    await this.bounces.markBounced(d.email_at_send);
  }

  async recordComplaint(token: string): Promise<void> {
    const d = await this.findByToken(token);
    if (!d) return;
    if (d.status === 'complained') return;
    await this.deliveries.update(d.id, { status: 'complained' });
    await this.newsletters.increment({ id: d.newsletter_id }, 'summary_complained', 1);
    await this.bounces.markComplained(d.email_at_send);
  }

  private async findByToken(token: string): Promise<NewsletterDelivery | null> {
    return this.deliveries.findOne({ where: { tracking_token: token } });
  }
}
