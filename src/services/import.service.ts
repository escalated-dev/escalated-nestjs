import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { Tag } from '../entities/tag.entity';
import { Department } from '../entities/department.entity';

export interface ImportResult {
  total: number;
  imported: number;
  failed: number;
  errors: { row: number; message: string }[];
}

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(TicketStatus)
    private readonly statusRepo: Repository<TicketStatus>,
    @InjectRepository(Tag)
    private readonly tagRepo: Repository<Tag>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
  ) {}

  async importTickets(data: any[], userId: number): Promise<ImportResult> {
    const result: ImportResult = { total: data.length, imported: 0, failed: 0, errors: [] };

    const defaultStatus = await this.statusRepo.findOne({ where: { isDefault: true } });

    for (let i = 0; i < data.length; i++) {
      try {
        const row = data[i];
        this.validateImportRow(row, i);

        const ticket = this.ticketRepo.create({
          referenceNumber: row.referenceNumber || this.generateRef(),
          subject: row.subject,
          description: row.description || '',
          priority: row.priority || 'medium',
          channel: row.channel || 'import',
          statusId: row.statusId || defaultStatus?.id,
          departmentId: row.departmentId || null,
          requesterId: row.requesterId || userId,
          assigneeId: row.assigneeId || null,
        });

        await this.ticketRepo.save(ticket);
        result.imported++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: i + 1,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  async importTags(data: { name: string; color?: string }[]): Promise<ImportResult> {
    const result: ImportResult = { total: data.length, imported: 0, failed: 0, errors: [] };

    for (let i = 0; i < data.length; i++) {
      try {
        const row = data[i];
        if (!row.name) throw new Error('Tag name is required');

        const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const existing = await this.tagRepo.findOne({ where: { slug } });
        if (existing) {
          result.failed++;
          result.errors.push({ row: i + 1, message: `Tag "${row.name}" already exists` });
          continue;
        }

        await this.tagRepo.save({
          name: row.name,
          slug,
          color: row.color || '#3b82f6',
        });
        result.imported++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: i + 1,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  async importDepartments(data: { name: string; description?: string }[]): Promise<ImportResult> {
    const result: ImportResult = { total: data.length, imported: 0, failed: 0, errors: [] };

    for (let i = 0; i < data.length; i++) {
      try {
        const row = data[i];
        if (!row.name) throw new Error('Department name is required');

        const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const existing = await this.departmentRepo.findOne({ where: { slug } });
        if (existing) {
          result.failed++;
          result.errors.push({ row: i + 1, message: `Department "${row.name}" already exists` });
          continue;
        }

        await this.departmentRepo.save({
          name: row.name,
          slug,
          description: row.description || null,
        });
        result.imported++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          row: i + 1,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  private validateImportRow(row: any, index: number): void {
    if (!row.subject) {
      throw new BadRequestException(`Row ${index + 1}: subject is required`);
    }
  }

  private generateRef(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TK-${timestamp}${random}`;
  }
}
