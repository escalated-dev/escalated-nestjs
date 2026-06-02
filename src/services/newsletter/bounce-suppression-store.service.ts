import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EscalatedSettings } from '../../entities/escalated-settings.entity';

@Injectable()
export class BounceSuppressionStoreService {
  private static readonly KEY = 'newsletter.suppressed_emails';

  constructor(
    @InjectRepository(EscalatedSettings)
    private readonly settings: Repository<EscalatedSettings>,
  ) {}

  async markBounced(email: string): Promise<void> {
    await this.mark(email);
  }

  async markComplained(email: string): Promise<void> {
    await this.mark(email);
  }

  async isBounced(email: string): Promise<boolean> {
    const list = await this.load();
    return list.includes(email.toLowerCase());
  }

  async filterSendable(emails: string[]): Promise<string[]> {
    const suppressed = new Set(await this.load());
    return emails.filter((e) => !suppressed.has(e.toLowerCase()));
  }

  private async mark(email: string): Promise<void> {
    const lowered = email.toLowerCase();
    const list = await this.load();
    if (list.includes(lowered)) return;
    list.push(lowered);
    const existing = await this.settings.findOne({
      where: { key: BounceSuppressionStoreService.KEY },
    });
    if (existing) {
      existing.value = JSON.stringify(list);
      existing.type = 'json';
      existing.group = 'newsletter';
      await this.settings.save(existing);
    } else {
      await this.settings.save(
        this.settings.create({
          key: BounceSuppressionStoreService.KEY,
          value: JSON.stringify(list),
          type: 'json',
          group: 'newsletter',
        }),
      );
    }
  }

  private async load(): Promise<string[]> {
    const row = await this.settings.findOne({
      where: { key: BounceSuppressionStoreService.KEY },
    });
    if (!row?.value) return [];
    try {
      const parsed = JSON.parse(row.value);
      return Array.isArray(parsed) ? parsed.map((e) => String(e).toLowerCase()) : [];
    } catch {
      return [];
    }
  }
}
