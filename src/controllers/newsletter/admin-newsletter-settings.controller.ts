import { Body, Controller, Get, Inject, Put, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { EscalatedSettings } from '../../entities/escalated-settings.entity';
import { NewsletterPermissionService } from '../../services/newsletter/newsletter-permission.service';
import {
  assertEmail,
  inertia,
  optionalString,
  redirect,
  requiredBoolean,
  requiredInteger,
  requiredString,
} from './newsletter-http.utils';

const SETTING_KEYS = {
  default_from: 'string',
  default_reply_to: 'string',
  default_theme: 'string',
  rate_limit_per_minute: 'number',
  batch_size: 'number',
  tracking_enabled: 'boolean',
} as const;

@Controller('admin/newsletters/settings')
export class AdminNewsletterSettingsController {
  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
    private readonly permissions: NewsletterPermissionService,
    @InjectRepository(EscalatedSettings)
    private readonly settings: Repository<EscalatedSettings>,
  ) {}

  @Get()
  async show(@Req() req: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const settings: Record<string, unknown> = {};
    for (const key of Object.keys(SETTING_KEYS)) {
      const row = await this.settings.findOne({ where: { key: `newsletter.${key}` } });
      settings[key] = row?.value ?? this.configFallback(key);
    }
    return inertia('Escalated/Admin/Newsletters/Settings', {
      settings,
      themes: ['default', 'branded'],
    });
  }

  @Put()
  async update(@Req() req: any, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const data = {
      default_from: assertEmail(optionalString(body, 'default_from'), 'default_from'),
      default_reply_to: assertEmail(optionalString(body, 'default_reply_to'), 'default_reply_to'),
      default_theme: requiredString(body, 'default_theme', 64),
      rate_limit_per_minute: requiredInteger(body, 'rate_limit_per_minute', 1, 10000),
      batch_size: requiredInteger(body, 'batch_size', 1, 1000),
      tracking_enabled: requiredBoolean(body, 'tracking_enabled'),
    };

    for (const [key, type] of Object.entries(SETTING_KEYS)) {
      const value = data[key as keyof typeof data];
      const stored = typeof value === 'boolean' ? String(Number(value)) : String(value ?? '');
      const existing = await this.settings.findOne({ where: { key: `newsletter.${key}` } });
      if (existing) {
        existing.value = stored;
        existing.type = type;
        existing.group = 'newsletter';
        await this.settings.save(existing);
      } else {
        await this.settings.save(
          this.settings.create({
            key: `newsletter.${key}`,
            value: stored,
            type,
            group: 'newsletter',
          }),
        );
      }
    }
    return redirect('/admin/newsletters/settings');
  }

  private configFallback(key: string): unknown {
    const options = this.options.newsletters ?? {};
    switch (key) {
      case 'default_from':
        return options.defaultFrom ?? null;
      case 'default_reply_to':
        return options.defaultReplyTo ?? null;
      case 'default_theme':
        return options.defaultTheme ?? 'default';
      case 'rate_limit_per_minute':
        return options.rateLimitPerMinute ?? 60;
      case 'batch_size':
        return options.batchSize ?? 50;
      case 'tracking_enabled':
        return options.trackingEnabled !== false;
      default:
        return null;
    }
  }
}
