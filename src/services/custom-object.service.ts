import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CustomObject, CustomObjectFieldDefinition } from '../entities/custom-object.entity';
import { CustomObjectRecord } from '../entities/custom-object-record.entity';
import { UiValidationException } from '../ui/inertia.interceptor';
import { isNumeric, isValidDate } from './custom-field.service';

/** The field types a custom object's schema may use (escalated-laravel's). */
export const CUSTOM_OBJECT_FIELD_TYPES = ['text', 'number', 'select', 'date', 'lookup'] as const;

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}

/** A custom object with escalated-laravel's keys. */
export function serializeCustomObject(object: CustomObject, recordsCount?: number) {
  return {
    id: object.id,
    name: object.name,
    slug: object.slug,
    fields_schema: object.fieldsSchema ?? [],
    ...(recordsCount !== undefined ? { records_count: recordsCount } : {}),
    created_at: iso(object.createdAt),
    updated_at: iso(object.updatedAt),
  };
}

export function serializeCustomObjectRecord(record: CustomObjectRecord) {
  return {
    id: record.id,
    object_id: record.objectId,
    data: record.data ?? {},
    created_at: iso(record.createdAt),
    updated_at: iso(record.updatedAt),
  };
}

/**
 * Custom objects and their records, as escalated-laravel's
 * Admin\CustomObjectController keeps them, with record `data` checked against
 * the object's schema. Invalid input throws `UiValidationException` (field
 * errors on the screens, a 422 for API clients).
 */
@Injectable()
export class CustomObjectService {
  constructor(
    @InjectRepository(CustomObject) private readonly objects: Repository<CustomObject>,
    @InjectRepository(CustomObjectRecord) private readonly records: Repository<CustomObjectRecord>,
  ) {}

  /** Every object, by name, with its `records_count`. */
  async list() {
    const [rows, counts] = await Promise.all([
      this.objects.find({ order: { name: 'ASC', id: 'ASC' } }),
      this.records
        .createQueryBuilder('record')
        .select('record.objectId', 'id')
        .addSelect('COUNT(record.id)', 'count')
        .groupBy('record.objectId')
        .getRawMany(),
    ]);
    const byObject = new Map(counts.map((row) => [Number(row.id), Number(row.count)]));
    return rows.map((object) => serializeCustomObject(object, byObject.get(object.id) ?? 0));
  }

  async find(id: number): Promise<CustomObject> {
    const object = await this.objects.findOne({ where: { id } });
    if (!object) throw new NotFoundException('Custom object not found');
    return object;
  }

  async create(body: any): Promise<CustomObject> {
    return this.objects.save(this.objects.create(await this.input(body)));
  }

  async update(id: number, body: any): Promise<CustomObject> {
    const object = await this.find(id);
    Object.assign(object, await this.input(body, object.id));
    return this.objects.save(object);
  }

  /** Deletes the object and its records. */
  async delete(id: number): Promise<void> {
    const object = await this.find(id);
    // The foreign key cascades; deleting here as well covers SQLite
    // connections that run with foreign keys off.
    await this.records.delete({ objectId: object.id });
    await this.objects.remove(object);
  }

  /** The object's records, newest first. */
  async recordsOf(object: CustomObject) {
    const rows = await this.records.find({
      where: { objectId: object.id },
      order: { id: 'DESC' },
    });
    return rows.map(serializeCustomObjectRecord);
  }

  async createRecord(objectId: number, data: unknown): Promise<CustomObjectRecord> {
    const object = await this.find(objectId);
    this.checkRecord(object, data);
    return this.records.save(
      this.records.create({ objectId: object.id, data: data as Record<string, unknown> }),
    );
  }

  async updateRecord(objectId: number, recordId: number, data: unknown) {
    const { object, record } = await this.findRecord(objectId, recordId);
    this.checkRecord(object, data);
    record.data = data as Record<string, unknown>;
    return this.records.save(record);
  }

  async deleteRecord(objectId: number, recordId: number): Promise<void> {
    const { record } = await this.findRecord(objectId, recordId);
    await this.records.remove(record);
  }

  /** The record, only when it belongs to the object (404 otherwise). */
  async findRecord(objectId: number, recordId: number) {
    const object = await this.find(objectId);
    const record = await this.records.findOne({ where: { id: recordId, objectId: object.id } });
    if (!record) throw new NotFoundException('Record not found');
    return { object, record };
  }

  /** Laravel's rules: name, a unique alpha_dash slug, and at least one schema field. */
  private async input(body: any, ignoreId?: number) {
    const input: any = isPlainObject(body) ? body : {};
    const errors: Record<string, string> = {};

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) errors.name = 'The name field is required.';
    else if (name.length > 255) errors.name = 'The name must not be greater than 255 characters.';

    const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
    if (!slug) errors.slug = 'The slug field is required.';
    else if (slug.length > 100) errors.slug = 'The slug must not be greater than 100 characters.';
    else if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
      errors.slug = 'The slug may only contain letters, numbers, dashes and underscores.';
    } else {
      const where = ignoreId != null ? { slug, id: Not(ignoreId) } : { slug };
      if (await this.objects.existsBy(where)) errors.slug = 'The slug has already been taken.';
    }

    const schema: CustomObjectFieldDefinition[] = [];
    if (!Array.isArray(input.fields_schema) || input.fields_schema.length === 0) {
      errors.fields_schema = 'The fields schema must have at least 1 item.';
    } else {
      input.fields_schema.forEach((raw: any, index: number) => {
        const key = `fields_schema.${index}`;
        if (!isPlainObject(raw)) {
          errors[key] = 'Each field must be an object.';
          return;
        }
        const fieldName = typeof raw.name === 'string' ? raw.name.trim() : '';
        if (!fieldName) errors[`${key}.name`] = 'The field name is required.';
        else if (fieldName.length > 100) {
          errors[`${key}.name`] = 'The field name must not be greater than 100 characters.';
        }
        if (!(CUSTOM_OBJECT_FIELD_TYPES as readonly string[]).includes(raw.type as string)) {
          errors[`${key}.type`] = 'The selected field type is invalid.';
        }
        if (raw.required !== undefined && typeof raw.required !== 'boolean') {
          errors[`${key}.required`] = 'The required flag must be true or false.';
        }
        if (raw.options !== undefined && !Array.isArray(raw.options)) {
          errors[`${key}.options`] = 'The options must be an array.';
        }
        const field: CustomObjectFieldDefinition = { name: fieldName, type: raw.type as any };
        if (raw.required !== undefined) field.required = Boolean(raw.required);
        if (Array.isArray(raw.options)) field.options = raw.options.map(String);
        schema.push(field);
      });
    }

    if (Object.keys(errors).length) throw new UiValidationException(errors);
    return { name, slug, fieldsSchema: schema };
  }

  /** Record `data` against the object's schema; errors keyed `data.<name>`. */
  private checkRecord(object: CustomObject, data: unknown): void {
    if (!isPlainObject(data)) {
      throw new UiValidationException({
        data: 'The data field is required and must be an object.',
      });
    }
    const errors: Record<string, string> = {};
    const schema = object.fieldsSchema ?? [];
    const known = new Set(schema.map((field) => field.name));

    for (const key of Object.keys(data)) {
      if (!known.has(key)) errors[`data.${key}`] = `The ${key} field is not part of this object.`;
    }
    for (const field of schema) {
      const key = `data.${field.name}`;
      const value = data[field.name];
      if (isBlank(value)) {
        if (field.required) errors[key] = `The ${field.name} field is required.`;
        continue;
      }
      if (field.type === 'number' && !isNumeric(value)) {
        errors[key] = `The ${field.name} field must be a number.`;
      } else if (field.type === 'date' && !isValidDate(value)) {
        errors[key] = `The ${field.name} field must be a valid date (YYYY-MM-DD).`;
      } else if (
        field.type === 'select' &&
        !(Array.isArray(field.options) && field.options.map(String).includes(String(value)))
      ) {
        errors[key] = `The selected ${field.name} is invalid.`;
      }
    }
    if (Object.keys(errors).length) throw new UiValidationException(errors);
  }
}
