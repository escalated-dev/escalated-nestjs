import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  async log(data: Partial<AuditLog>): Promise<AuditLog> {
    return this.auditLogRepo.save(data);
  }

  async findAll(filters?: {
    userId?: number;
    entityType?: string;
    entityId?: number;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    perPage?: number;
  }): Promise<{ data: AuditLog[]; total: number }> {
    const qb = this.auditLogRepo.createQueryBuilder('log');

    if (filters?.userId) {
      qb.andWhere('log.userId = :userId', { userId: filters.userId });
    }
    if (filters?.entityType) {
      qb.andWhere('log.entityType = :entityType', { entityType: filters.entityType });
    }
    if (filters?.entityId) {
      qb.andWhere('log.entityId = :entityId', { entityId: filters.entityId });
    }
    if (filters?.action) {
      qb.andWhere('log.action = :action', { action: filters.action });
    }
    if (filters?.startDate && filters?.endDate) {
      qb.andWhere('log.createdAt BETWEEN :startDate AND :endDate', {
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    }

    qb.orderBy('log.createdAt', 'DESC');

    const page = filters?.page || 1;
    const perPage = filters?.perPage || 50;
    qb.skip((page - 1) * perPage).take(perPage);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findByEntity(entityType: string, entityId: number): Promise<AuditLog[]> {
    return this.auditLogRepo.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
    });
  }
}
