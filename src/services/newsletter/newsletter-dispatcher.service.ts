import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { Newsletter, NewsletterDelivery } from '../../entities/newsletter';
import { NewsletterRendererService } from './newsletter-renderer.service';

@Injectable()
export class NewsletterDispatcherService {
  private readonly logger = new Logger(NewsletterDispatcherService.name);

  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
    @InjectRepository(Newsletter)
    private readonly newsletters: Repository<Newsletter>,
    @InjectRepository(NewsletterDelivery)
    private readonly deliveries: Repository<NewsletterDelivery>,
    private readonly renderer: NewsletterRendererService,
    @Optional() private readonly mailer?: MailerService,
  ) {}

  async dispatchBatch(): Promise<void> {
    if (!this.options.enableNewsletters) return;

    await this.reclaimStuckRows();

    const batchSize = this.options.newsletters?.batchSize ?? 50;

    const pending = await this.deliveries.find({
      where: { status: 'pending' },
      order: { id: 'ASC' as const },
      take: batchSize,
    });

    if (pending.length === 0) {
      await this.finalizeCompletedNewsletters();
      return;
    }

    await this.deliveries.update(
      { id: In(pending.map((d) => d.id)) },
      { status: 'queued', claimed_at: new Date() },
    );

    for (const delivery of pending) {
      await this.dispatchOne(delivery);
    }

    await this.finalizeCompletedNewsletters();
    await this.checkAutoPauseAcrossActiveNewsletters();
  }

  private async dispatchOne(delivery: NewsletterDelivery): Promise<void> {
    const full = await this.deliveries.findOne({
      where: { id: delivery.id },
      relations: { newsletter: { template: true }, contact: true },
    });
    if (!full) return;

    try {
      if (!this.mailer) {
        throw new Error('Mailer not configured — set options.mail to enable sending');
      }
      const html = this.renderer.render(full);
      const unsub = this.renderer.unsubscribeUrl(full);
      const host = new URL(this.options.appUrl ?? 'http://localhost').host;
      await this.mailer.sendMail({
        to: full.email_at_send,
        from: this.formatFrom(full),
        replyTo: full.newsletter.reply_to ?? undefined,
        subject: full.newsletter.subject,
        html,
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'X-Escalated-Newsletter-Id': String(full.newsletter_id),
          'Message-ID': `<n-${full.newsletter_id}-${full.tracking_token}@${host}>`,
        },
      });
      await this.deliveries.update(full.id, {
        status: 'sent',
        sent_at: new Date(),
        claimed_at: null,
      });
      await this.newsletters.increment({ id: full.newsletter_id }, 'summary_sent', 1);
    } catch (error) {
      this.logger.warn(
        `Newsletter delivery ${full.id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const attempts = full.attempt_count + 1;
      if (attempts >= 3) {
        await this.deliveries.update(full.id, {
          status: 'failed',
          failure_reason: error instanceof Error ? error.message : String(error),
          attempt_count: attempts,
          claimed_at: null,
        });
      } else {
        await this.deliveries.update(full.id, {
          status: 'pending',
          attempt_count: attempts,
          claimed_at: null,
        });
      }
    }
  }

  private formatFrom(d: NewsletterDelivery): string {
    return d.newsletter.from_name
      ? `"${d.newsletter.from_name}" <${d.newsletter.from_email}>`
      : d.newsletter.from_email;
  }

  private async reclaimStuckRows(): Promise<void> {
    const minutes = this.options.newsletters?.claimTimeoutMinutes ?? 10;
    const cutoff = new Date(Date.now() - minutes * 60_000);
    await this.deliveries.update(
      { status: 'queued', claimed_at: LessThan(cutoff) },
      { status: 'pending', claimed_at: null },
    );
  }

  private async finalizeCompletedNewsletters(): Promise<void> {
    const sending = await this.newsletters.find({ where: { status: 'sending' } });
    for (const n of sending) {
      const remaining = await this.deliveries.count({
        where: [
          { newsletter_id: n.id, status: 'pending' },
          { newsletter_id: n.id, status: 'queued' },
        ],
      });
      if (remaining === 0) {
        await this.newsletters.update(n.id, {
          status: 'sent',
          sent_at: n.sent_at ?? new Date(),
        });
      }
    }
  }

  private async checkAutoPauseAcrossActiveNewsletters(): Promise<void> {
    const threshold = this.options.newsletters?.autoPauseThreshold ?? 100;
    const rate = this.options.newsletters?.autoPauseBounceRate ?? 0.05;
    const sending = await this.newsletters.find({ where: { status: 'sending' } });
    for (const n of sending) {
      const total = await this.deliveries.count({
        where: [
          { newsletter_id: n.id, status: 'sent' },
          { newsletter_id: n.id, status: 'bounced' },
          { newsletter_id: n.id, status: 'complained' },
          { newsletter_id: n.id, status: 'failed' },
        ],
      });
      if (total < threshold) continue;
      const bounced = await this.deliveries.count({
        where: { newsletter_id: n.id, status: 'bounced' },
      });
      if (total > 0 && bounced / total >= rate) {
        await this.newsletters.update(n.id, { status: 'paused' });
        this.logger.warn(`Newsletter ${n.id} auto-paused: ${bounced}/${total} bounced`);
      }
    }
  }
}
