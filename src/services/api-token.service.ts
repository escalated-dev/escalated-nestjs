import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ApiToken } from '../entities/api-token.entity';
import { UserId } from '../config/user-id-column';

/**
 * The value stored for an API token: the SHA-256 hex digest of the plain
 * token, as escalated-laravel stores it. The plain token is returned once, on
 * creation; lookups hash what the client sends.
 */
export function hashApiToken(plainTextToken: string): string {
  return crypto.createHash('sha256').update(plainTextToken).digest('hex');
}

@Injectable()
export class ApiTokenService {
  constructor(
    @InjectRepository(ApiToken)
    private readonly tokenRepo: Repository<ApiToken>,
  ) {}

  async findAll(userId?: UserId): Promise<ApiToken[]> {
    const where: any = {};
    if (userId) where.userId = userId;
    return this.tokenRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findById(id: number): Promise<ApiToken> {
    const token = await this.tokenRepo.findOne({ where: { id } });
    if (!token) throw new NotFoundException(`API Token #${id} not found`);
    return token;
  }

  async create(data: {
    name: string;
    userId: UserId;
    abilities?: string[];
    expiresAt?: Date;
  }): Promise<{ token: ApiToken; plainTextToken: string }> {
    const plainTextToken = crypto.randomBytes(40).toString('hex');

    const token = this.tokenRepo.create({
      name: data.name,
      token: hashApiToken(plainTextToken),
      userId: data.userId,
      abilities: data.abilities || ['*'],
      expiresAt: data.expiresAt,
    });

    const saved = await this.tokenRepo.save(token);
    return { token: saved, plainTextToken };
  }

  async revoke(id: number): Promise<void> {
    await this.findById(id);
    await this.tokenRepo.update(id, { isActive: false });
  }

  async delete(id: number): Promise<void> {
    const token = await this.findById(id);
    await this.tokenRepo.remove(token);
  }

  async validate(tokenStr: string, requiredAbility?: string): Promise<ApiToken | null> {
    const token = await this.tokenRepo.findOne({
      where: { token: hashApiToken(tokenStr), isActive: true },
    });

    if (!token) return null;
    if (token.expiresAt && new Date(token.expiresAt) < new Date()) return null;

    if (requiredAbility && !tokenHasAbility(token, requiredAbility)) {
      return null;
    }

    await this.tokenRepo.update(token.id, { lastUsedAt: new Date() });
    return token;
  }
}

/** True when the token grants `ability`, directly or through `*`. */
export function tokenHasAbility(token: Pick<ApiToken, 'abilities'>, ability: string): boolean {
  const abilities = Array.isArray(token.abilities) ? token.abilities : [];
  return abilities.includes('*') || abilities.includes(ability);
}
