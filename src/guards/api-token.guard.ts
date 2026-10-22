import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiToken } from '../entities/api-token.entity';
import { hashApiToken, tokenHasAbility } from '../services/api-token.service';
import {
  ESCALATED_REQUESTED_GROUP,
  EscalatedAdminGuard,
  EscalatedAgentGuard,
} from './escalated-route.guard';

export const API_TOKEN_ABILITY_KEY = 'escalated:apiTokenAbility';

/**
 * Names the ability an API token needs for a host route or controller
 * (`agent`, `admin`, or any ability the host issues). Escalated's own admin
 * and agent routes need no decorator: they require `admin` and `agent`.
 */
export const ApiTokenAbility = (ability: string) => SetMetadata(API_TOKEN_ABILITY_KEY, ability);

/**
 * Authenticates a request by its `Authorization: Bearer <token>` API token and
 * enforces the token's abilities, as escalated-laravel's AuthenticateApiToken:
 * admin routes need `admin`, agent routes need `agent`, `*` grants every
 * ability, and a token without the needed ability is refused with 403.
 *
 * The needed ability comes from `@ApiTokenAbility()`, else from the Escalated
 * route group the guard is checking for (`adminGuard` / `agentGuard`), else
 * from an Escalated admin/agent group guard on the route. Customer routes and
 * host routes that name none need no ability.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    @InjectRepository(ApiToken)
    private readonly apiTokenRepo: Repository<ApiToken>,
    @Optional() private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API token');
    }

    const token = authHeader.substring(7);
    const apiToken = await this.apiTokenRepo.findOne({
      where: { token: hashApiToken(token), isActive: true },
    });

    if (!apiToken) {
      throw new UnauthorizedException('Invalid API token');
    }

    if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
      throw new UnauthorizedException('API token has expired');
    }

    const ability = this.requiredAbility(context, request);
    if (ability && !tokenHasAbility(apiToken, ability)) {
      throw new ForbiddenException('Insufficient permissions.');
    }

    // Update last used timestamp
    await this.apiTokenRepo.update(apiToken.id, { lastUsedAt: new Date() });

    // Attach token info to request
    request.apiToken = apiToken;
    request.apiUserId = apiToken.userId;

    return true;
  }

  private requiredAbility(context: ExecutionContext, request: any): string | null {
    const targets = [context.getHandler(), context.getClass()];

    const explicit = this.reflector.getAllAndOverride<string | undefined>(
      API_TOKEN_ABILITY_KEY,
      targets,
    );
    if (explicit) return explicit;

    const group = request?.[ESCALATED_REQUESTED_GROUP];
    if (group === 'admin' || group === 'agent') return group;
    if (group === 'customer') return null;

    // The token guard ran ahead of Escalated's group guard (a global guard,
    // or listed first): read the group from the route's own guards.
    const guards = targets.flatMap(
      (target) => (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [],
    );
    if (guards.some((guard) => isGuard(guard, EscalatedAdminGuard))) return 'admin';
    if (guards.some((guard) => isGuard(guard, EscalatedAgentGuard))) return 'agent';
    return null;
  }
}

function isGuard(guard: unknown, type: new (...args: any[]) => unknown): boolean {
  return guard === type || guard instanceof type;
}
