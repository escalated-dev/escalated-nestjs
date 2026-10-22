import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { CustomField } from '../entities/custom-field.entity';
import { CustomFieldValue } from '../entities/custom-field-value.entity';
import { UiValidationException } from '../ui/inertia.interceptor';

/** escalated-laravel's custom field types. */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'multi_select',
  'checkbox',
  'date',
  'number',
] as const;

/** escalated-laravel's custom field contexts. */
export const CUSTOM_FIELD_CONTEXTS = ['ticket', 'user', 'organization'] as const;

export const TICKET_CONTEXT = 'ticket';

/** A validated ticket value: the string to store, or null to delete the stored one. */
export type PendingCustomFieldValues = Array<{ field: CustomField; value: string | null }>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

function bool(value: unknown): boolean | null {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on')
    return true;
  if (value === false || value === 0 || value === '0' || value === 'false' || value === '')
    return false;
  return null;
}

/** `YYYY-MM-DD` and a real calendar date. */
export function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && NUMBER.test(value.trim());
}

/** Laravel's `Str::slug($name, '_')` for ASCII names. */
export function fieldSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The field's type in escalated-laravel's names (`multiselect` rows read as `multi_select`). */
export function customFieldType(field: Pick<CustomField, 'fieldType'>): string {
  return field.fieldType === 'multiselect' ? 'multi_select' : field.fieldType;
}

/** Every column of a definition with escalated-laravel's snake_case keys (the admin screens). */
export function serializeCustomField(field: CustomField) {
  return {
    id: field.id,
    name: field.name,
    slug: field.slug,
    type: customFieldType(field),
    context: field.entityType,
    options: field.options ?? null,
    required: field.isRequired === true,
    placeholder: field.placeholder ?? null,
    description: field.description ?? null,
    validation_rules: field.validationRules ?? null,
    conditions: field.conditions ?? null,
    position: field.sortOrder ?? 0,
    active: field.isActive !== false,
    created_at: iso(field.createdAt),
    updated_at: iso(field.updatedAt),
  };
}

/** What a ticket page or payload carries for a field. */
export function customFieldDefinition(field: CustomField) {
  return {
    id: field.id,
    name: field.name,
    slug: field.slug,
    type: customFieldType(field),
    options: field.options ?? null,
    required: field.isRequired === true,
    placeholder: field.placeholder ?? null,
    description: field.description ?? null,
    position: field.sortOrder ?? 0,
  };
}

function checkboxValue(value: unknown): '1' | '0' | null {
  if (value === true || value === 1 || value === '1' || value === 'true') return '1';
  if (value === false || value === 0 || value === '0' || value === 'false') return '0';
  return null;
}

/** Checks one non-empty value against its field: the string to store, or an error. */
function encode(field: CustomField, value: unknown): { value: string } | { error: string } {
  const label = field.name;
  const options = Array.isArray(field.options) ? field.options.map(String) : [];

  switch (customFieldType(field)) {
    case 'number':
      return isNumeric(value)
        ? { value: String(value).trim() }
        : { error: `The ${label} field must be a number.` };
    case 'date':
      return isValidDate(value)
        ? { value: value as string }
        : { error: `The ${label} field must be a valid date (YYYY-MM-DD).` };
    case 'checkbox': {
      const encoded = checkboxValue(value);
      return encoded === null
        ? { error: `The ${label} field must be true or false.` }
        : { value: encoded };
    }
    case 'select':
      return typeof value === 'string' && options.includes(value)
        ? { value }
        : { error: `The selected ${label} is invalid.` };
    case 'multi_select': {
      if (!Array.isArray(value)) return { error: `The ${label} field must be an array.` };
      const chosen = value.map((v) => (typeof v === 'string' ? v : null));
      if (chosen.some((v) => v === null || !options.includes(v))) {
        return { error: `The selected ${label} is invalid.` };
      }
      return { value: JSON.stringify(chosen) };
    }
    case 'textarea':
      return typeof value === 'string'
        ? { value }
        : { error: `The ${label} field must be a string.` };
    case 'text':
    default:
      if (typeof value !== 'string') return { error: `The ${label} field must be a string.` };
      return value.length > 255
        ? { error: `The ${label} field must not be greater than 255 characters.` }
        : { value };
  }
}

/** A stored string as a page or API client reads it. */
export function decodeCustomFieldValue(
  field: CustomField,
  raw: string | null | undefined,
): unknown {
  if (raw === null || raw === undefined) return null;
  switch (customFieldType(field)) {
    case 'multi_select':
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return raw.split(',').filter(Boolean);
      }
    case 'checkbox':
      return raw === '1' || raw === 'true';
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    default:
      return raw;
  }
}

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
    if (
      ['select', 'multiselect', 'multi_select'].includes(data.fieldType) &&
      !data.options?.length
    ) {
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
    // The foreign key cascades; deleting here as well covers SQLite
    // connections that run with foreign keys off.
    await this.valueRepo.delete({ customFieldId: field.id });
    await this.fieldRepo.remove(field);
  }

  async getValues(entityType: string, entityId: number): Promise<CustomFieldValue[]> {
    return this.valueRepo.find({
      where: { entityType, entityId },
      relations: { customField: true },
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

      const existing = await this.valueRepo.findOne({
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

  // ---- Admin screens (escalated-laravel's Admin\CustomFieldController) ----

  /** Every definition, by position, for `Admin/CustomFields/Index`. */
  async adminList() {
    const fields = await this.fieldRepo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    return fields.map(serializeCustomField);
  }

  /** Creates a definition from the screen's form (Laravel's rules); errors are field errors. */
  async adminCreate(body: any): Promise<CustomField> {
    const attributes = this.adminInput(body);
    const explicit = typeof body?.slug === 'string' ? body.slug.trim() : '';
    if (explicit && (await this.fieldRepo.existsBy({ slug: explicit }))) {
      throw new UiValidationException({ slug: 'The slug has already been taken.' });
    }
    const slug = explicit || (await this.uniqueSlug(attributes.name!));
    return this.fieldRepo.save(
      this.fieldRepo.create({
        entityType: TICKET_CONTEXT,
        isRequired: false,
        isActive: true,
        sortOrder: 0,
        ...attributes,
        slug,
      }),
    );
  }

  /** Updates a definition from the screen's form. Fields left out keep their values. */
  async adminUpdate(id: number, body: any): Promise<CustomField> {
    const field = await this.findById(id);
    const attributes = this.adminInput({ context: field.entityType, ...body }, field);
    const explicit = typeof body?.slug === 'string' ? body.slug.trim() : '';
    if (explicit) {
      if (await this.fieldRepo.existsBy({ slug: explicit, id: Not(field.id) })) {
        throw new UiValidationException({ slug: 'The slug has already been taken.' });
      }
      attributes.slug = explicit;
    }
    Object.assign(field, attributes);
    return this.fieldRepo.save(field);
  }

  /** `positions: [{id, position}]` (Laravel's reorder). */
  async reorder(positions: unknown): Promise<void> {
    const valid =
      Array.isArray(positions) &&
      positions.every(
        (item: any) =>
          isPlainObject(item) &&
          Number.isInteger(Number(item.id)) &&
          item.position !== null &&
          item.position !== '' &&
          Number.isInteger(Number(item.position)),
      );
    if (!valid) {
      throw new UiValidationException({
        positions: 'The positions field must be a list of {id, position}.',
      });
    }
    const ids = (positions as any[]).map((item) => Number(item.id));
    const found = await this.fieldRepo.countBy({ id: In(ids) });
    if (found !== new Set(ids).size) {
      throw new UiValidationException({ positions: 'The selected field is invalid.' });
    }
    for (const item of positions as any[]) {
      await this.fieldRepo.update(Number(item.id), { sortOrder: Number(item.position) });
    }
  }

  /**
   * The slug for a new field: the name with `_` separators, suffixed `_2`,
   * `_3`... when taken.
   */
  async uniqueSlug(name: string, ignoreId?: number): Promise<string> {
    const base = fieldSlug(name).slice(0, 240) || 'field';
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? base : `${base}_${n}`;
      const where = ignoreId != null ? { slug: candidate, id: Not(ignoreId) } : { slug: candidate };
      if (!(await this.fieldRepo.existsBy(where))) return candidate;
    }
  }

  /** escalated-laravel's StoreCustomFieldRequest rules, as entity columns. */
  private adminInput(body: any, existing?: CustomField): Partial<CustomField> {
    const errors: Record<string, string> = {};
    const attributes: Partial<CustomField> = {};
    const input: any = isPlainObject(body) ? body : {};

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) errors.name = 'The name field is required.';
    else if (name.length > 255) errors.name = 'The name must not be greater than 255 characters.';
    else attributes.name = name;

    const type = input.type === 'multiselect' ? 'multi_select' : input.type;
    if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(type)) {
      errors.type = 'The selected type is invalid.';
    } else attributes.fieldType = type;

    const context = input.context ?? TICKET_CONTEXT;
    const keepsOld = existing != null && context === existing.entityType;
    if (!(CUSTOM_FIELD_CONTEXTS as readonly string[]).includes(context) && !keepsOld) {
      errors.context = 'The selected context is invalid.';
    } else attributes.entityType = context;

    if (input.slug != null && input.slug !== '') {
      if (typeof input.slug !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(input.slug.trim())) {
        errors.slug = 'The slug may only contain letters, numbers, dashes and underscores.';
      }
    }

    if (input.options !== undefined) {
      if (input.options === null) attributes.options = null as any;
      else if (!Array.isArray(input.options)) errors.options = 'The options must be an array.';
      else {
        attributes.options = input.options
          .map((option: unknown) => (option == null ? '' : String(option).trim()))
          .filter((option: string) => option !== '');
      }
    }
    if ((type === 'select' || type === 'multi_select') && !errors.options) {
      const options = input.options !== undefined ? attributes.options : existing?.options;
      if (!Array.isArray(options) || options.length === 0) {
        errors.options = 'Select fields need at least one option.';
      }
    }

    for (const [key, column] of [
      ['required', 'isRequired'],
      ['active', 'isActive'],
    ] as const) {
      if (input[key] === undefined) continue;
      const value = bool(input[key]);
      if (value === null) errors[key] = `The ${key} field must be true or false.`;
      else (attributes as any)[column] = value;
    }

    if (input.placeholder !== undefined) {
      if (input.placeholder === null || input.placeholder === '') attributes.placeholder = null;
      else if (typeof input.placeholder !== 'string')
        errors.placeholder = 'The placeholder must be a string.';
      else if (input.placeholder.length > 255)
        errors.placeholder = 'The placeholder must not be greater than 255 characters.';
      else attributes.placeholder = input.placeholder;
    }

    if (input.description !== undefined) {
      if (input.description === null || input.description === '') attributes.description = null;
      else if (typeof input.description !== 'string')
        errors.description = 'The description must be a string.';
      else attributes.description = input.description;
    }

    for (const [key, column] of [
      ['validation_rules', 'validationRules'],
      ['conditions', 'conditions'],
    ] as const) {
      if (input[key] === undefined) continue;
      if (input[key] === null) (attributes as any)[column] = null;
      else if (typeof input[key] !== 'object')
        errors[key] = `The ${key.replace('_', ' ')} must be an array.`;
      else (attributes as any)[column] = input[key];
    }

    if (input.position !== undefined && input.position !== null && input.position !== '') {
      const position = Number(input.position);
      if (!Number.isInteger(position)) errors.position = 'The position must be an integer.';
      else attributes.sortOrder = position;
    }

    if (Object.keys(errors).length) throw new UiValidationException(errors);
    return attributes;
  }

  // ---- Ticket values (CUSTOM-FIELDS-SPEC section 2) ----

  /** Active ticket-context fields, by position. */
  async ticketFields(): Promise<CustomField[]> {
    return this.fieldRepo.find({
      where: { entityType: TICKET_CONTEXT, isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  /** The `custom_fields` prop of a ticket create page. */
  async ticketDefinitions() {
    return (await this.ticketFields()).map(customFieldDefinition);
  }

  /**
   * Checks the custom field values a ticket create or update sends, before
   * anything is written. `custom_fields` is keyed by field slug; the older
   * `customFields` keyed by field id works too. Only active ticket fields
   * count: another key is refused. On create (`required`) every required field
   * must be filled; otherwise only the keys sent are checked, and sending none
   * changes nothing (null).
   *
   * Throws `UiValidationException` with errors keyed `custom_fields.<slug>`.
   */
  async resolveTicketInput(
    input: { custom_fields?: unknown; customFields?: unknown },
    options: { required?: boolean } = {},
  ): Promise<PendingCustomFieldValues | null> {
    const sent = [input?.customFields, input?.custom_fields].filter((value) => value != null);
    if (!sent.length && !options.required) return null;

    const errors: Record<string, string> = {};
    if (sent.some((value) => !isPlainObject(value))) {
      throw new UiValidationException({ custom_fields: 'The custom fields must be an object.' });
    }

    const fields = await this.ticketFields();
    const bySlug = new Map(fields.map((field) => [field.slug, field]));
    const byId = new Map(fields.map((field) => [String(field.id), field]));
    // slug => value, the newer `custom_fields` winning over `customFields`.
    const values = new Map<string, unknown>();
    for (const container of sent as Array<Record<string, unknown>>) {
      for (const [key, value] of Object.entries(container)) {
        const field = bySlug.get(key) ?? byId.get(key);
        if (!field) {
          errors[`custom_fields.${key}`] = 'The selected custom field is invalid.';
          continue;
        }
        values.set(field.slug, value);
      }
    }

    const pending: PendingCustomFieldValues = [];
    for (const field of fields) {
      const key = `custom_fields.${field.slug}`;
      const present = values.has(field.slug);
      const value = values.get(field.slug);

      if (isEmpty(value)) {
        if (field.isRequired && (options.required || present)) {
          errors[key] = `The ${field.name} field is required.`;
        } else if (present) {
          pending.push({ field, value: null });
        }
        continue;
      }

      const result = encode(field, value);
      if ('error' in result) errors[key] = result.error;
      else pending.push({ field, value: result.value });
    }

    if (Object.keys(errors).length) throw new UiValidationException(errors);
    return pending;
  }

  /** Writes checked values for a ticket: null deletes, anything else upserts. */
  async saveTicketValues(ticketId: number, values: PendingCustomFieldValues): Promise<void> {
    for (const { field, value } of values) {
      const existing = await this.valueRepo.findOne({
        where: { customFieldId: field.id, entityType: TICKET_CONTEXT, entityId: ticketId },
      });
      if (value === null) {
        if (existing) await this.valueRepo.remove(existing);
      } else if (existing) {
        existing.value = value;
        await this.valueRepo.save(existing);
      } else {
        await this.valueRepo.save({
          customFieldId: field.id,
          entityType: TICKET_CONTEXT,
          entityId: ticketId,
          value,
        });
      }
    }
  }

  /** A ticket's `custom_fields`: the active ticket definitions, each with its decoded `value`. */
  async ticketValues(ticketId: number) {
    const fields = await this.ticketFields();
    if (!fields.length) return [];
    const rows = await this.valueRepo.find({
      where: {
        entityType: TICKET_CONTEXT,
        entityId: ticketId,
        customFieldId: In(fields.map((field) => field.id)),
      },
    });
    const byField = new Map(rows.map((row) => [Number(row.customFieldId), row.value]));
    return fields.map((field) => ({
      ...customFieldDefinition(field),
      value: decodeCustomFieldValue(field, byField.get(field.id)),
    }));
  }
}
