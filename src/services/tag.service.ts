import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../entities/tag.entity';

@Injectable()
export class TagService {
  constructor(
    @InjectRepository(Tag)
    private readonly tagRepo: Repository<Tag>,
  ) {}

  async findAll(): Promise<Tag[]> {
    return this.tagRepo.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<Tag> {
    const tag = await this.tagRepo.findOne({ where: { id } });
    if (!tag) throw new NotFoundException(`Tag #${id} not found`);
    return tag;
  }

  async create(data: Partial<Tag>): Promise<Tag> {
    if (!data.slug && data.name) {
      data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
    const tag = this.tagRepo.create(data);
    return this.tagRepo.save(tag);
  }

  async update(id: number, data: Partial<Tag>): Promise<Tag> {
    await this.findById(id);
    await this.tagRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const tag = await this.findById(id);
    await this.tagRepo.remove(tag);
  }
}
