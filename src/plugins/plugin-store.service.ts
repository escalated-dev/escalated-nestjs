import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PluginStoreRecord } from '../entities/plugin-store-record.entity';
import type { PluginQueryOptions } from './plugin-definition';

const CONFIG = '__config__';

/** A field name is a dotted path of letters, digits and underscores. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

const OPERATORS = ['$gt', '$gte', '$lt', '$lte', '$ne', '$in', '$nin'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fieldOf(data: unknown, field: string): unknown {
  let value: unknown = data;
  for (const part of field.split('.')) {
    if (!isRecord(value)) return undefined;
    value = value[part];
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Equality as escalated-laravel's `whereJsonContains`: an array field contains the value. */
function contains(value: unknown, wanted: unknown): boolean {
  if (Array.isArray(value)) {
    return Array.isArray(wanted)
      ? wanted.every((item) => value.some((entry) => same(entry, item)))
      : value.some((entry) => same(entry, wanted));
  }
  return same(value, wanted);
}

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function matches(value: unknown, op: string, operand: unknown): boolean {
  switch (op) {
    case '$ne':
      return !same(value, operand);
    case '$in':
      return (Array.isArray(operand) ? operand : [operand]).some((item) => same(value, item));
    case '$nin':
      return !(Array.isArray(operand) ? operand : [operand]).some((item) => same(value, item));
    default: {
      const order = compare(value, operand);
      if (order === null) return false;
      if (op === '$gt') return order > 0;
      if (op === '$gte') return order >= 0;
      if (op === '$lt') return order < 0;
      return order <= 0;
    }
  }
}

/** Numbers by value first, then strings as text, then everything else. */
function sortKey(value: unknown): [number, number | string] {
  if (typeof value === 'number') return [0, value];
  if (typeof value === 'string') return [1, value];
  return [2, ''];
}

/**
 * `ctx.config` and `ctx.store` for one plugin, as escalated-laravel's
 * ContextHandler serves them, over `escalated_plugin_store`. Every method
 * takes the plugin's name from the caller, never from the plugin.
 *
 * Queries filter in this process rather than in SQL: the data column is JSON
 * text on every supported database, and the operators behave identically on
 * all of them. Field names are still validated, so a filter never becomes
 * anything but a path lookup.
 */
@Injectable()
export class PluginStoreService {
  constructor(
    @InjectRepository(PluginStoreRecord) private readonly records: Repository<PluginStoreRecord>,
  ) {}

  private row(plugin: string, collection: string, key: string) {
    return this.records.findOne({ where: { plugin, collection, key } });
  }

  private present(record: PluginStoreRecord): Record<string, unknown> {
    return { _id: record.id, ...(isRecord(record.data) ? record.data : {}) };
  }

  private validateField(field: string): void {
    if (!FIELD.test(field)) throw new Error(`Invalid store field name: ${field}`);
  }

  async configAll(plugin: string): Promise<Record<string, unknown>> {
    const record = await this.row(plugin, CONFIG, CONFIG);
    return isRecord(record?.data) ? record.data : {};
  }

  async configGet(plugin: string, key: string): Promise<unknown> {
    return (await this.configAll(plugin))[key] ?? null;
  }

  async configSet(plugin: string, data: Record<string, unknown>): Promise<void> {
    if (!isRecord(data)) throw new Error('ctx.config.set requires an object');
    const merged = { ...(await this.configAll(plugin)), ...data };
    await this.set(plugin, CONFIG, CONFIG, merged);
  }

  async get(plugin: string, collection: string, key: string): Promise<unknown> {
    return (await this.row(plugin, collection, key))?.data ?? null;
  }

  async set(plugin: string, collection: string, key: string, value: unknown): Promise<void> {
    const existing = await this.row(plugin, collection, key);
    if (existing) {
      existing.data = value ?? null;
      await this.records.save(existing);
    } else {
      await this.records.save(
        this.records.create({ plugin, collection, key, data: value ?? null }),
      );
    }
  }

  async query(
    plugin: string,
    collection: string,
    filter: Record<string, unknown> = {},
    options: PluginQueryOptions = {},
  ): Promise<Record<string, unknown>[]> {
    const conditions = Object.entries(isRecord(filter) ? filter : {});
    for (const [field, condition] of conditions) {
      this.validateField(field);
      if (isRecord(condition)) {
        for (const op of Object.keys(condition)) {
          if (!OPERATORS.includes(op)) throw new Error(`Unsupported store operator: ${op}`);
        }
      }
    }
    if (options.orderBy !== undefined) this.validateField(String(options.orderBy));

    let rows = (
      await this.records.find({ where: { plugin, collection }, order: { id: 'ASC' } })
    ).filter((record) =>
      conditions.every(([field, condition]) => {
        const value = fieldOf(record.data, field);
        return isRecord(condition)
          ? Object.entries(condition).every(([op, operand]) => matches(value, op, operand))
          : contains(value, condition);
      }),
    );

    if (options.orderBy !== undefined) {
      const field = String(options.orderBy);
      const direction = String(options.order ?? 'asc').toLowerCase() === 'desc' ? -1 : 1;
      rows = rows.sort((a, b) => {
        const [ra, va] = sortKey(fieldOf(a.data, field));
        const [rb, vb] = sortKey(fieldOf(b.data, field));
        if (ra !== rb) return (ra - rb) * direction;
        return (va < vb ? -1 : va > vb ? 1 : 0) * direction;
      });
    }
    if (options.limit !== undefined) rows = rows.slice(0, Math.max(0, Number(options.limit) || 0));

    return rows.map((record) => this.present(record));
  }

  async insert(
    plugin: string,
    collection: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!isRecord(data)) throw new Error('ctx.store.insert requires an object');
    const key = data.key === undefined || data.key === null ? null : String(data.key);
    const record = await this.records.save(this.records.create({ plugin, collection, key, data }));
    return this.present(record);
  }

  async update(
    plugin: string,
    collection: string,
    key: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!isRecord(data)) throw new Error('ctx.store.update requires an object');
    const record = await this.row(plugin, collection, key);
    if (!record) throw new Error(`No ${collection} record with key ${key}`);
    record.data = { ...(isRecord(record.data) ? record.data : {}), ...data };
    return this.present(await this.records.save(record));
  }

  async delete(plugin: string, collection: string, key: string): Promise<void> {
    await this.records.delete({ plugin, collection, key: key ?? IsNull() });
  }
}
