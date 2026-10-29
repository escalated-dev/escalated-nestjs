import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControlService } from '../access/access-control.service';

export const PERMISSIONS_KEY = 'escalated_permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Requires `@RequirePermissions(...)` slugs from the user's Escalated role
 * while roles & permissions is switched on (`access.rolesPermissions`). While
 * it is off the host guards decide and this lets the request through (ADR
 * 2026-10-29-configurable-access-features).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    for (const permission of requiredPermissions) {
      await this.access.require(request, permission);
    }
    return true;
  }
}
