import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Skill } from '../entities/skill.entity';
import { AgentSkill } from '../entities/agent-skill.entity';
import { Tag } from '../entities/tag.entity';
import { Department } from '../entities/department.entity';
import { AgentProfile } from '../entities/agent-profile.entity';
import { CreateSkillDto } from '../dto/admin/create-skill.dto';
import { UpdateSkillDto } from '../dto/admin/update-skill.dto';
import { AgentSkillEntryDto } from '../dto/admin/agent-skill.dto';

export interface SkillListItem {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  agentsCount: number;
  routingTagsCount: number;
  routingDepartmentsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillEditPayload {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  routingTagIds: number[];
  routingDepartmentIds: number[];
  agents: Array<{ userId: number; proficiency: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillFormContext {
  availableTags: Array<{ id: number; name: string }>;
  availableDepartments: Array<{ id: number; name: string }>;
  availableAgents: Array<{ id: number; name: string; email: string }>;
}

@Injectable()
export class SkillService {
  constructor(
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
    @InjectRepository(AgentSkill)
    private readonly agentSkillRepo: Repository<AgentSkill>,
    @InjectRepository(Tag)
    private readonly tagRepo: Repository<Tag>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(AgentProfile)
    private readonly agentProfileRepo: Repository<AgentProfile>,
  ) {}

  async findAll(): Promise<Skill[]> {
    return this.skillRepo.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<Skill> {
    const skill = await this.skillRepo.findOne({ where: { id } });
    if (!skill) throw new NotFoundException(`Skill #${id} not found`);
    return skill;
  }

  async listForAdmin(): Promise<SkillListItem[]> {
    const skills = await this.skillRepo.find({
      relations: ['routingTags', 'routingDepartments', 'agentSkills'],
      order: { name: 'ASC' },
    });

    return skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      agentsCount: skill.agentSkills?.length ?? 0,
      routingTagsCount: skill.routingTags?.length ?? 0,
      routingDepartmentsCount: skill.routingDepartments?.length ?? 0,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    }));
  }

  async findForEdit(id: number): Promise<SkillEditPayload> {
    const skill = await this.skillRepo.findOne({
      where: { id },
      relations: ['routingTags', 'routingDepartments', 'agentSkills'],
    });
    if (!skill) throw new NotFoundException(`Skill #${id} not found`);

    return {
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      routingTagIds: (skill.routingTags ?? []).map((t) => t.id),
      routingDepartmentIds: (skill.routingDepartments ?? []).map((d) => d.id),
      agents: (skill.agentSkills ?? []).map((a) => ({
        userId: a.userId,
        proficiency: a.proficiency,
      })),
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    };
  }

  async getFormContext(): Promise<SkillFormContext> {
    const [tags, departments, agents] = await Promise.all([
      this.tagRepo.find({ order: { name: 'ASC' } }),
      this.departmentRepo.find({ where: { isActive: true }, order: { name: 'ASC' } }),
      this.agentProfileRepo.find({
        where: { isActive: true },
        order: { displayName: 'ASC' },
      }),
    ]);

    return {
      availableTags: tags.map((t) => ({ id: t.id, name: t.name })),
      availableDepartments: departments.map((d) => ({ id: d.id, name: d.name })),
      availableAgents: agents.map((a) => ({
        id: a.userId,
        name: a.displayName ?? `Agent #${a.userId}`,
        email: '',
      })),
    };
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    const skill = this.skillRepo.create({
      name: dto.name,
      slug: dto.slug ?? this.slugify(dto.name),
      description: dto.description ?? null,
    });

    skill.routingTags = await this.resolveTags(dto.routingTagIds);
    skill.routingDepartments = await this.resolveDepartments(dto.routingDepartmentIds);

    const saved = await this.skillRepo.save(skill);
    await this.syncAgents(saved.id, dto.agents ?? []);

    return this.skillRepo.findOne({
      where: { id: saved.id },
      relations: ['routingTags', 'routingDepartments', 'agentSkills'],
    });
  }

  async update(id: number, dto: UpdateSkillDto): Promise<Skill> {
    const skill = await this.skillRepo.findOne({
      where: { id },
      relations: ['routingTags', 'routingDepartments'],
    });
    if (!skill) throw new NotFoundException(`Skill #${id} not found`);

    if (dto.name !== undefined) skill.name = dto.name;
    if (dto.slug !== undefined) skill.slug = dto.slug;
    if (dto.description !== undefined) skill.description = dto.description;

    if (dto.routingTagIds !== undefined) {
      skill.routingTags = await this.resolveTags(dto.routingTagIds);
    }
    if (dto.routingDepartmentIds !== undefined) {
      skill.routingDepartments = await this.resolveDepartments(dto.routingDepartmentIds);
    }

    await this.skillRepo.save(skill);

    if (dto.agents !== undefined) {
      await this.syncAgents(id, dto.agents);
    }

    return this.skillRepo.findOne({
      where: { id },
      relations: ['routingTags', 'routingDepartments', 'agentSkills'],
    });
  }

  async delete(id: number): Promise<void> {
    const skill = await this.findById(id);
    await this.agentSkillRepo.delete({ skillId: id });
    await this.skillRepo.remove(skill);
  }

  private async resolveTags(ids?: number[]): Promise<Tag[]> {
    if (!ids?.length) return [];
    return this.tagRepo.findBy({ id: In(ids) });
  }

  private async resolveDepartments(ids?: number[]): Promise<Department[]> {
    if (!ids?.length) return [];
    return this.departmentRepo.findBy({ id: In(ids) });
  }

  private async syncAgents(skillId: number, agents: AgentSkillEntryDto[]): Promise<void> {
    await this.agentSkillRepo.delete({ skillId });
    if (!agents.length) return;

    const rows = agents.map((agent) =>
      this.agentSkillRepo.create({
        skillId,
        userId: agent.userId,
        proficiency: agent.proficiency,
      }),
    );
    await this.agentSkillRepo.save(rows);
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
}
