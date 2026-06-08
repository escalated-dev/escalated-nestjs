import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Contact } from '../../entities/contact.entity';
import { Newsletter, NewsletterDelivery } from '../../entities/newsletter';
import { ContactSegmentResolverService } from './contact-segment-resolver.service';
import { BounceSuppressionStoreService } from './bounce-suppression-store.service';

@Injectable()
export class NewsletterPlannerService {
  constructor(
    private readonly segments: ContactSegmentResolverService,
    private readonly bounces: BounceSuppressionStoreService,
    @InjectRepository(Newsletter)
    private readonly newsletters: Repository<Newsletter>,
    @InjectRepository(NewsletterDelivery)
    private readonly deliveries: Repository<NewsletterDelivery>,
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
  ) {}

  async plan(newsletter: Newsletter): Promise<void> {
    await this.newsletters.update(newsletter.id, { status: 'sending' });

    const list = await this.newsletters
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.targetList', 'list')
      .where('n.id = :id', { id: newsletter.id })
      .getOne();
    if (!list?.targetList) return;

    const contactIds = await this.segments.resolveSendable(list.targetList);
    if (contactIds.length === 0) {
      await this.newsletters.update(newsletter.id, { summary_total: 0 });
      return;
    }

    const contacts = await this.contacts.find({
      where: { id: In(contactIds) },
      select: { id: true, email: true },
    });
    const emails = contacts.map((c) => c.email);
    const sendable = new Set(
      (await this.bounces.filterSendable(emails)).map((e) => e.toLowerCase()),
    );

    const rows: Partial<NewsletterDelivery>[] = [];
    for (const contact of contacts) {
      if (!sendable.has(contact.email.toLowerCase())) continue;
      rows.push({
        newsletter_id: newsletter.id,
        contact_id: contact.id,
        email_at_send: contact.email,
        status: 'pending',
        tracking_token: this.token(),
        attempt_count: 0,
        is_test: false,
      });
    }

    for (let i = 0; i < rows.length; i += 500) {
      await this.deliveries.insert(rows.slice(i, i + 500));
    }
    await this.newsletters.update(newsletter.id, { summary_total: rows.length });
  }

  private token(): string {
    return randomBytes(20).toString('hex'); // 40 hex chars
  }
}
