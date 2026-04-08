import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';

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
      relations: ['permissions'],
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<Role> {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['permissions'],
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

  async seedPermissions(): Promise<void> {
    const permissions = [
      { slug: 'tickets.view', name: 'View Tickets', group: 'tickets' },
      { slug: 'tickets.create', name: 'Create Tickets', group: 'tickets' },
      { slug: 'tickets.update', name: 'Update Tickets', group: 'tickets' },
      { slug: 'tickets.delete', name: 'Delete Tickets', group: 'tickets' },
      { slug: 'tickets.assign', name: 'Assign Tickets', group: 'tickets' },
      { slug: 'tickets.merge', name: 'Merge Tickets', group: 'tickets' },
      { slug: 'tickets.split', name: 'Split Tickets', group: 'tickets' },
      { slug: 'agents.view', name: 'View Agents', group: 'agents' },
      { slug: 'agents.manage', name: 'Manage Agents', group: 'agents' },
      { slug: 'admin.settings', name: 'Manage Settings', group: 'admin' },
      { slug: 'admin.webhooks', name: 'Manage Webhooks', group: 'admin' },
      { slug: 'admin.roles', name: 'Manage Roles', group: 'admin' },
      { slug: 'admin.sla', name: 'Manage SLA Policies', group: 'admin' },
      { slug: 'admin.custom_fields', name: 'Manage Custom Fields', group: 'admin' },
      { slug: 'admin.import', name: 'Import Data', group: 'admin' },
      { slug: 'kb.manage', name: 'Manage Knowledge Base', group: 'knowledge_base' },
      { slug: 'reports.view', name: 'View Reports', group: 'reports' },
    ];

    for (const perm of permissions) {
      const existing = await this.permissionRepo.findOne({ where: { slug: perm.slug } });
      if (!existing) {
        await this.permissionRepo.save(perm);
      }
    }
  }
}
