import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiToken } from '../entities/api-token.entity';

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    @InjectRepository(ApiToken)
    private readonly apiTokenRepo: Repository<ApiToken>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API token');
    }

    const token = authHeader.substring(7);
    const apiToken = await this.apiTokenRepo.findOne({
      where: { token, isActive: true },
    });

    if (!apiToken) {
      throw new UnauthorizedException('Invalid API token');
    }

    if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
      throw new UnauthorizedException('API token has expired');
    }

    // Update last used timestamp
    await this.apiTokenRepo.update(apiToken.id, { lastUsedAt: new Date() });

    // Attach token info to request
    request.apiToken = apiToken;
    request.apiUserId = apiToken.userId;

    return true;
  }
}
