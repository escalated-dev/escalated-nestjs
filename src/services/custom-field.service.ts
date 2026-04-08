import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomField } from '../entities/custom-field.entity';
import { CustomFieldValue } from '../entities/custom-field-value.entity';

@Injectable()
export class CustomFieldService {
  constructor(
    @InjectRepository(CustomField)
    private readonly fieldRepo: Repository<CustomField>,
    @InjectRepository(CustomFieldValue)
    private readonly valueRepo: Repository<CustomFieldValue>,
  ) {}

  async findAll(entityType?: string): Promise<CustomField[]> {
    const where: any = { isActive: true };
    if (entityType) where.entityType = entityType;
    return this.fieldRepo.find({ where, order: { sortOrder: 'ASC' } });
  }

  async findById(id: number): Promise<CustomField> {
    const field = await this.fieldRepo.findOne({ where: { id } });
    if (!field) throw new NotFoundException(`Custom field #${id} not found`);
    return field;
  }

  async create(data: Partial<CustomField>): Promise<CustomField> {
    if (['select', 'multiselect'].includes(data.fieldType) && !data.options?.length) {
      throw new BadRequestException('Options are required for select/multiselect fields');
    }
    const field = this.fieldRepo.create(data);
    return this.fieldRepo.save(field);
  }

  async update(id: number, data: Partial<CustomField>): Promise<CustomField> {
    await this.findById(id);
    await this.fieldRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const field = await this.findById(id);
    await this.fieldRepo.remove(field);
  }

  async getValues(entityType: string, entityId: number): Promise<CustomFieldValue[]> {
    return this.valueRepo.find({
      where: { entityType, entityId },
      relations: ['customField'],
    });
  }

  async setValues(
    entityType: string,
    entityId: number,
    values: Record<number, any>,
  ): Promise<CustomFieldValue[]> {
    const results: CustomFieldValue[] = [];

    for (const [fieldId, value] of Object.entries(values)) {
      const field = await this.findById(parseInt(fieldId, 10));

      // Validate value against field type
      this.validateValue(field, value);

      let existing = await this.valueRepo.findOne({
        where: {
          customFieldId: field.id,
          entityType,
          entityId,
        },
      });

      if (existing) {
        existing.value = String(value);
        results.push(await this.valueRepo.save(existing));
      } else {
        results.push(
          await this.valueRepo.save({
            customFieldId: field.id,
            entityType,
            entityId,
            value: String(value),
          }),
        );
      }
    }

    return results;
  }

  private validateValue(field: CustomField, value: any): void {
    if (field.isRequired && (value === null || value === undefined || value === '')) {
      throw new BadRequestException(`Field "${field.name}" is required`);
    }

    if (value === null || value === undefined || value === '') return;

    switch (field.fieldType) {
      case 'number':
        if (isNaN(Number(value))) {
          throw new BadRequestException(`Field "${field.name}" must be a number`);
        }
        break;
      case 'select':
        if (!field.options?.includes(String(value))) {
          throw new BadRequestException(
            `Invalid option for field "${field.name}". Valid options: ${field.options.join(', ')}`,
          );
        }
        break;
      case 'checkbox':
        if (!['true', 'false', '0', '1'].includes(String(value))) {
          throw new BadRequestException(`Field "${field.name}" must be a boolean value`);
        }
        break;
    }
  }
}
