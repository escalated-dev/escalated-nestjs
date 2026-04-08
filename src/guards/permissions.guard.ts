import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentProfile } from '../entities/agent-profile.entity';
import { Role } from '../entities/role.entity';

export const PERMISSIONS_KEY = 'escalated_permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(AgentProfile)
    private readonly agentProfileRepo: Repository<AgentProfile>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
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
    const userId = request.user?.id || request.apiUserId;

    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const agentProfile = await this.agentProfileRepo.findOne({
      where: { userId },
    });

    if (!agentProfile || !agentProfile.roleId) {
      throw new ForbiddenException('No agent profile or role found');
    }

    const role = await this.roleRepo.findOne({
      where: { id: agentProfile.roleId },
      relations: ['permissions'],
    });

    if (!role) {
      throw new ForbiddenException('Role not found');
    }

    // Admin role has all permissions
    if (role.slug === 'admin') {
      return true;
    }

    const userPermissions = role.permissions.map((p) => p.slug);
    const hasAllPermissions = requiredPermissions.every((p) => userPermissions.includes(p));

    if (!hasAllPermissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
