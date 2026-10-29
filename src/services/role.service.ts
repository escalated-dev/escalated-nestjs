import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { AgentProfile } from '../entities/agent-profile.entity';
import { seedRolesAndPermissions } from '../access/permission-seed';
import type { UserId } from '../config/user-id-column';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
  ) {}

  async findAll(): Promise<Role[]> {
    return this.roleRepo.find({
      relations: { permissions: true },
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<Role> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: { permissions: true },
    });
    if (!role) throw new NotFoundException(`Role #${id} not found`);
    return role;
  }

  async create(data: {
    name: string;
    slug: string;
    description?: string;
    permissionIds?: number[];
  }): Promise<Role> {
    const role = this.roleRepo.create({
      name: data.name,
      slug: data.slug,
      description: data.description,
    });

    const saved = await this.roleRepo.save(role);

    if (data.permissionIds?.length) {
      const permissions = await this.permissionRepo.findBy({ id: In(data.permissionIds) });
      saved.permissions = permissions;
      await this.roleRepo.save(saved);
    }

    return this.findById(saved.id);
  }

  async update(
    id: number,
    data: { name?: string; description?: string; permissionIds?: number[] },
  ): Promise<Role> {
    const role = await this.findById(id);

    if (data.name) role.name = data.name;
    if (data.description !== undefined) role.description = data.description;

    if (data.permissionIds) {
      const permissions = await this.permissionRepo.findBy({ id: In(data.permissionIds) });
      role.permissions = permissions;
    }

    await this.roleRepo.save(role);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const role = await this.findById(id);
    if (role.isSystem) {
      throw new BadRequestException('Cannot delete system roles');
    }
    await this.roleRepo.remove(role);
  }

  async getAllPermissions(): Promise<Permission[]> {
    return this.permissionRepo.find({ order: { group: 'ASC', name: 'ASC' } });
  }

  /**
   * Creates the permissions and system roles (escalated-laravel's
   * PermissionSeeder slugs). The `RolesAndPermissions` migration does the
   * same; this is for hosts that seed in code.
   */
  async seedPermissions(): Promise<void> {
    await seedRolesAndPermissions(this.roleRepo.manager);
  }

  /**
   * Gives a host user an Escalated role by slug (their agent profile's role),
   * creating the profile when they have none. Use it to bootstrap the first
   * admin before switching roles & permissions on, as Laravel's
   * `escalated:roles:assign`.
   */
  async assignRole(userId: UserId, roleSlug: string): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { slug: roleSlug } });
    if (!role) throw new NotFoundException(`Role ${roleSlug} not found`);
    const profiles = this.roleRepo.manager.getRepository(AgentProfile);
    const profile = await profiles.findOne({ where: { userId } });
    if (profile) {
      await profiles.update(profile.id, { roleId: role.id });
    } else {
      await profiles.save(profiles.create({ userId, roleId: role.id }));
    }
    return role;
  }
}
