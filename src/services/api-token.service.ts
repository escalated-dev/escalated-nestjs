import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ApiToken } from '../entities/api-token.entity';

@Injectable()
export class ApiTokenService {
  constructor(
    @InjectRepository(ApiToken)
    private readonly tokenRepo: Repository<ApiToken>,
  ) {}

  async findAll(userId?: number): Promise<ApiToken[]> {
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
    userId: number;
    abilities?: string[];
    expiresAt?: Date;
  }): Promise<{ token: ApiToken; plainTextToken: string }> {
    const plainTextToken = crypto.randomBytes(40).toString('hex');

    const token = this.tokenRepo.create({
      name: data.name,
      token: plainTextToken,
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
      where: { token: tokenStr, isActive: true },
    });

    if (!token) return null;
    if (token.expiresAt && new Date(token.expiresAt) < new Date()) return null;

    if (
      requiredAbility &&
      !token.abilities.includes('*') &&
      !token.abilities.includes(requiredAbility)
    ) {
      return null;
    }

    await this.tokenRepo.update(token.id, { lastUsedAt: new Date() });
    return token;
  }
}
