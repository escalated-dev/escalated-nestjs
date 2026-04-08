import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Skill } from '../entities/skill.entity';

@Injectable()
export class SkillService {
  constructor(
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
  ) {}

  async findAll(): Promise<Skill[]> {
    return this.skillRepo.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<Skill> {
    const skill = await this.skillRepo.findOne({ where: { id } });
    if (!skill) throw new NotFoundException(`Skill #${id} not found`);
    return skill;
  }

  async create(data: Partial<Skill>): Promise<Skill> {
    if (!data.slug && data.name) {
      data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
    const skill = this.skillRepo.create(data);
    return this.skillRepo.save(skill);
  }

  async update(id: number, data: Partial<Skill>): Promise<Skill> {
    await this.findById(id);
    await this.skillRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const skill = await this.findById(id);
    await this.skillRepo.remove(skill);
  }
}
