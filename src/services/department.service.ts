import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from '../entities/department.entity';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
  ) {}

  async findAll(): Promise<Department[]> {
    return this.departmentRepo.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async findById(id: number): Promise<Department> {
    const dept = await this.departmentRepo.findOne({ where: { id } });
    if (!dept) throw new NotFoundException(`Department #${id} not found`);
    return dept;
  }

  async create(data: Partial<Department>): Promise<Department> {
    if (!data.slug && data.name) {
      data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
    const dept = this.departmentRepo.create(data);
    return this.departmentRepo.save(dept);
  }

  async update(id: number, data: Partial<Department>): Promise<Department> {
    await this.findById(id);
    await this.departmentRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const dept = await this.findById(id);
    await this.departmentRepo.remove(dept);
  }
}
