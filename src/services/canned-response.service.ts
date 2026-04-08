import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CannedResponse } from '../entities/canned-response.entity';

@Injectable()
export class CannedResponseService {
  constructor(
    @InjectRepository(CannedResponse)
    private readonly cannedResponseRepo: Repository<CannedResponse>,
  ) {}

  async findAll(userId?: number, departmentId?: number): Promise<CannedResponse[]> {
    const qb = this.cannedResponseRepo
      .createQueryBuilder('cr')
      .where('cr.isActive = :isActive', { isActive: true })
      .andWhere('(cr.scope = :shared OR cr.createdBy = :userId)', {
        shared: 'shared',
        userId: userId || 0,
      });

    if (departmentId) {
      qb.andWhere('(cr.departmentId IS NULL OR cr.departmentId = :departmentId)', {
        departmentId,
      });
    }

    return qb.orderBy('cr.title', 'ASC').getMany();
  }

  async findById(id: number): Promise<CannedResponse> {
    const response = await this.cannedResponseRepo.findOne({ where: { id } });
    if (!response) throw new NotFoundException(`Canned response #${id} not found`);
    return response;
  }

  async findByShortCode(shortCode: string): Promise<CannedResponse | null> {
    return this.cannedResponseRepo.findOne({
      where: { shortCode, isActive: true },
    });
  }

  async create(data: Partial<CannedResponse>): Promise<CannedResponse> {
    const response = this.cannedResponseRepo.create(data);
    return this.cannedResponseRepo.save(response);
  }

  async update(id: number, data: Partial<CannedResponse>): Promise<CannedResponse> {
    await this.findById(id);
    await this.cannedResponseRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const response = await this.findById(id);
    await this.cannedResponseRepo.remove(response);
  }
}
