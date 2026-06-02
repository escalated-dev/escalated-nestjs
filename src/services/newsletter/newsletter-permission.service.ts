import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserId } from '../../config/user-id-column';
import { AgentProfile } from '../../entities/agent-profile.entity';
import { Role } from '../../entities/role.entity';

@Injectable()
export class NewsletterPermissionService {
  constructor(
    @InjectRepository(AgentProfile)
    private readonly agentProfiles: Repository<AgentProfile>,
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
  ) {}

  async require(request: any, permission: 'newsletters.manage' | 'newsletters.send'): Promise<void> {
    const userId = (request?.user?.id ?? request?.apiUserId) as UserId | undefined;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const profile = await this.agentProfiles.findOne({ where: { userId } });
    if (!profile?.roleId) {
      throw new ForbiddenException('No agent profile or role found');
    }

    const role = await this.roles.findOne({
      where: { id: profile.roleId },
      relations: ['permissions'],
    });
    if (!role) {
      throw new ForbiddenException('Role not found');
    }
    if (role.slug === 'admin') {
      return;
    }
    if (!(role.permissions ?? []).some((p) => p.slug === permission)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
