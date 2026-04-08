import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EscalatedSettings } from '../entities/escalated-settings.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(EscalatedSettings)
    private readonly settingsRepo: Repository<EscalatedSettings>,
  ) {}

  async get(key: string, defaultValue?: string): Promise<string | null> {
    const setting = await this.settingsRepo.findOne({ where: { key } });
    return setting?.value ?? defaultValue ?? null;
  }

  async getTyped<T>(key: string, defaultValue?: T): Promise<T> {
    const setting = await this.settingsRepo.findOne({ where: { key } });
    if (!setting) return defaultValue as T;

    switch (setting.type) {
      case 'boolean':
        return (setting.value === 'true') as any;
      case 'number':
        return Number(setting.value) as any;
      case 'json':
        return JSON.parse(setting.value || '{}') as any;
      default:
        return setting.value as any;
    }
  }

  async set(key: string, value: any, type: string = 'string', group: string = 'general'): Promise<EscalatedSettings> {
    let setting = await this.settingsRepo.findOne({ where: { key } });

    const stringValue = type === 'json' ? JSON.stringify(value) : String(value);

    if (setting) {
      setting.value = stringValue;
      setting.type = type;
      return this.settingsRepo.save(setting);
    }

    return this.settingsRepo.save({
      key,
      value: stringValue,
      type,
      group,
    });
  }

  async getAll(group?: string): Promise<EscalatedSettings[]> {
    const where: any = {};
    if (group) where.group = group;
    return this.settingsRepo.find({ where, order: { key: 'ASC' } });
  }

  async setMany(settings: { key: string; value: any; type?: string; group?: string }[]): Promise<void> {
    for (const s of settings) {
      await this.set(s.key, s.value, s.type || 'string', s.group || 'general');
    }
  }

  async delete(key: string): Promise<void> {
    await this.settingsRepo.delete({ key });
  }
}
