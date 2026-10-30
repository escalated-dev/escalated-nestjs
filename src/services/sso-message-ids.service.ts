import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { SsoMessageId } from '../entities/sso-message-id.entity';

const now = () => Math.floor(Date.now() / 1000);

/**
 * Single-use SSO message IDs, as escalated-laravel's SsoMessageIds: issued
 * requests to be answered once (`remember` / `consume`), and accepted IDs
 * that must not come again (`claim`). Expired rows are pruned on write.
 */
@Injectable()
export class SsoMessageIdsService {
  constructor(@InjectRepository(SsoMessageId) private readonly ids: Repository<SsoMessageId>) {}

  /** Stores an ID that a later message must name (an issued request). */
  async remember(kind: string, messageId: string, expiresAt: number): Promise<void> {
    await this.prune();
    await this.ids.insert({ kind, messageId, expiresAt });
  }

  /** Removes an unexpired remembered ID: true only the first time. */
  async consume(kind: string, messageId: string): Promise<boolean> {
    if (!messageId || messageId.length > 191) return false;
    const result = await this.ids.delete({ kind, messageId, expiresAt: MoreThan(now()) });
    return result.affected === 1;
  }

  /** Records an ID as used: true the first time, false on a replay. */
  async claim(kind: string, messageId: string, expiresAt: number): Promise<boolean> {
    if (!messageId || messageId.length > 191) return false;
    await this.prune();
    try {
      await this.ids.insert({ kind, messageId, expiresAt });
      return true;
    } catch {
      return false;
    }
  }

  private async prune(): Promise<void> {
    await this.ids.delete({ expiresAt: LessThanOrEqual(now()) });
  }
}
