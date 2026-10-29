import {
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import { AgentProfile } from '../entities/agent-profile.entity';
import { Role } from '../entities/role.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { findStatusBySlugOrId } from '../services/status-lookup';
import { accessFeatureEnabled } from './access-features';
import { normalizeRoutePath, requiredPermissions } from './route-permissions';

function present(id: unknown): id is UserId {
  return (typeof id === 'number' || typeof id === 'string') && id !== '' && String(id) !== '0';
}

/** The route path a handler was declared at (controller path + method path). */
export function declaredRoutePath(context: ExecutionContext, request?: any): string {
  const controller = Reflect.getMetadata(PATH_METADATA, context.getClass()) ?? '';
  let handler = Reflect.getMetadata(PATH_METADATA, context.getHandler()) ?? '';
  if (Array.isArray(handler)) {
    // Several paths on one handler: the one Express matched, else the first.
    const matched = String(request?.route?.path ?? '');
    handler =
      handler.find((path: string) =>
        matched.endsWith(normalizeRoutePath(`${controller}/${path}`)),
      ) ?? handler[0];
  }
  return normalizeRoutePath(`${controller}/${handler}`);
}

/** The HTTP method a handler was declared for, or the request's for `@All`. */
function declaredMethod(context: ExecutionContext, request: any): string {
  const method = Reflect.getMetadata(METHOD_METADATA, context.getHandler());
  if (method === undefined || method === RequestMethod.ALL) return String(request?.method ?? 'GET');
  return RequestMethod[method] ?? String(request?.method ?? 'GET');
}

/**
 * Roles & permissions (ADR 2026-10-29-configurable-access-features).
 *
 * A user's permissions are their Escalated role's permissions: the role on
 * their agent profile. Nothing else grants one, not the host's admin guard
 * and not the role's slug. While the `access.rolesPermissions` switch is off
 * the host guards decide everything and this grants every check.
 */
@Injectable()
export class AccessControlService {
  private readonly logger = new Logger('EscalatedAccess');

  constructor(
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(TicketStatus) private readonly statuses: Repository<TicketStatus>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  /** Whether roles & permissions is switched on for this install. */
  enabled(): boolean {
    return accessFeatureEnabled(this.options, 'roles_permissions');
  }

  /** The acting user's id, as the rest of the package reads it. */
  userId(request: any): UserId | null {
    const user = this.options?.userResolver?.(request) ?? request?.user;
    if (present(user?.id)) return user.id;
    return present(request?.apiUserId) ? request.apiUserId : null;
  }

  /** Every permission slug the user's role grants; [] without one. */
  async userPermissions(userId: UserId | null | undefined): Promise<string[]> {
    if (!present(userId)) return [];
    try {
      const profile = await this.profiles.findOne({ where: { userId } });
      if (!profile?.roleId) return [];
      const roles = await this.roles.find({
        where: { id: In([profile.roleId]) },
        relations: { permissions: true },
      });
      const slugs = new Set<string>();
      for (const role of roles)
        for (const permission of role.permissions ?? []) slugs.add(permission.slug);
      return [...slugs].sort();
    } catch (error) {
      this.logger.warn(`Could not read permissions: ${(error as Error)?.message}`);
      return [];
    }
  }

  /** Whether the user may do what the permission covers; always true while the switch is off. */
  async allows(userId: UserId | null | undefined, slug: string): Promise<boolean> {
    if (!this.enabled()) return true;
    return (await this.userPermissions(userId)).includes(slug);
  }

  /** Like `allows`, answering 403 instead of false. */
  async require(request: any, slug: string): Promise<void> {
    if (!(await this.allows(this.userId(request), slug))) {
      throw new ForbiddenException(`You do not have the required permission: ${slug}`);
    }
  }

  /**
   * The route's permissions (route-permissions.ts) from the user's role,
   * after the host guard admitted the request to the admin or agent area.
   * A route missing from the map is refused. Does nothing while off.
   */
  async enforceRoute(context: ExecutionContext): Promise<void> {
    if (!this.enabled()) return;
    const request = context.switchToHttp().getRequest();
    const userId = this.userId(request);
    if (!userId) throw new ForbiddenException('Unauthorized.');

    const required = await requiredPermissions({
      method: declaredMethod(context, request),
      path: declaredRoutePath(context, request),
      body: request?.body,
      status: (value) => findStatusBySlugOrId(this.statuses, value),
    });
    if (required === null) {
      throw new ForbiddenException('This route has no permission mapping.');
    }

    const granted = await this.userPermissions(userId);
    for (const slug of required) {
      if (!granted.includes(slug)) {
        throw new ForbiddenException(`You do not have the required permission: ${slug}`);
      }
    }
  }

  /**
   * The `escalated.permissions` the shared frontend checks: the user's slugs
   * while on; `['*']` for staff while off (the guards decide everything);
   * `[]` for anyone else.
   */
  async sharedPermissions(userId: UserId | null | undefined, isStaff: boolean): Promise<string[]> {
    if (!present(userId)) return [];
    if (!this.enabled()) return isStaff ? ['*'] : [];
    return this.userPermissions(userId);
  }
}
