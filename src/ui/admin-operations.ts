import type { AgentCapacity } from '../entities/agent-capacity.entity';
import type { AuditLog } from '../entities/audit-log.entity';
import type { Automation } from '../entities/automation.entity';
import type { BusinessSchedule } from '../entities/business-schedule.entity';
import type { Holiday } from '../entities/holiday.entity';
import type { UserId } from '../config/user-id-column';
import { UiValidationException } from './inertia.interceptor';
import { iso, type UserDirectory } from './serializers';

/**
 * The admin operations screens' shapes and form input (automations, business
 * hours, skills, agent capacity and the audit log), as escalated-laravel's
 * AutomationController, BusinessHoursController, SkillController,
 * CapacityController and AuditLogController send and validate them.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

function requiredName(body: any, max: number): string {
  const name = body?.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new UiValidationException({ name: 'The name field is required.' });
  }
  if (name.length > max) {
    throw new UiValidationException({
      name: `The name may not be greater than ${max} characters.`,
    });
  }
  return name.trim();
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

// Automations

export function serializeAutomation(automation: Automation) {
  return {
    id: automation.id,
    name: automation.name,
    description: automation.description ?? null,
    conditions: automation.conditions ?? [],
    actions: automation.actions ?? [],
    active: automation.active !== false,
    position: automation.position ?? 0,
    last_run_at: iso(automation.lastRunAt),
    created_at: iso(automation.createdAt),
    updated_at: iso(automation.updatedAt),
  };
}

/** Laravel's rules: a name, and at least one condition and one action. */
export function automationInput(body: any): {
  name: string;
  conditions: Record<string, any>[];
  actions: Record<string, any>[];
  active: boolean;
} {
  const errors: Record<string, string> = {};
  let name = '';
  try {
    name = requiredName(body, 255);
  } catch (error) {
    Object.assign(errors, (error as UiValidationException).errors);
  }
  const list = (key: 'conditions' | 'actions') => {
    const value = body?.[key];
    if (!Array.isArray(value) || !value.length || !value.every(isRecord)) {
      errors[key] = `The ${key} field must have at least 1 item.`;
      return [];
    }
    return value as Record<string, any>[];
  };
  const conditions = list('conditions');
  const actions = list('actions');
  if (Object.keys(errors).length) throw new UiValidationException(errors);
  return { name, conditions, actions, active: bool(body?.active, true) };
}

// Business hours

export function serializeHoliday(holiday: Holiday) {
  return {
    id: holiday.id,
    schedule_id: holiday.businessScheduleId,
    name: holiday.name,
    date: holiday.date,
    recurring: holiday.isRecurring === true,
    created_at: iso(holiday.createdAt),
  };
}

export function serializeBusinessSchedule(schedule: BusinessSchedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    timezone: schedule.timezone,
    is_default: schedule.isDefault === true,
    schedule: schedule.schedule ?? {},
    holidays: [...(schedule.holidays ?? [])]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id)
      .map(serializeHoliday),
    created_at: iso(schedule.createdAt),
    updated_at: iso(schedule.updatedAt),
  };
}

/** Every IANA zone this runtime knows, as PHP's `timezone_identifiers_list()`. */
export function timezones(): string[] {
  const zones = (Intl as any).supportedValuesOf?.('timeZone') ?? [];
  return [...new Set<string>([...zones, 'UTC'])].sort();
}

function isTimezone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function businessScheduleInput(body: any): {
  name: string;
  timezone: string;
  isDefault: boolean;
  schedule: Record<string, any>;
  holidays: Array<{ name: string; date: string; isRecurring: boolean }>;
} {
  const errors: Record<string, string> = {};
  let name = '';
  try {
    name = requiredName(body, 255);
  } catch (error) {
    Object.assign(errors, (error as UiValidationException).errors);
  }
  if (!isTimezone(body?.timezone)) errors.timezone = 'The timezone must be a valid timezone.';
  if (!isRecord(body?.schedule)) errors.schedule = 'The schedule field is required.';

  const raw = body?.holidays ?? [];
  const holidays: Array<{ name: string; date: string; isRecurring: boolean }> = [];
  if (!Array.isArray(raw)) {
    errors.holidays = 'The holidays must be a list.';
  } else {
    raw.forEach((holiday: any, i: number) => {
      const holidayName = holiday?.name;
      if (typeof holidayName !== 'string' || !holidayName.trim() || holidayName.length > 255) {
        errors[`holidays.${i}.name`] = 'The holiday name field is required.';
      }
      const date = String(holiday?.date ?? '');
      if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date.slice(0, 10)))) {
        errors[`holidays.${i}.date`] = 'The holiday date must be a valid date.';
      }
      holidays.push({
        name: String(holidayName ?? '').trim(),
        date: date.slice(0, 10),
        isRecurring: bool(holiday?.recurring, false),
      });
    });
  }
  if (Object.keys(errors).length) throw new UiValidationException(errors);
  return {
    name,
    timezone: body.timezone,
    isDefault: bool(body?.is_default, false),
    schedule: body.schedule,
    holidays,
  };
}

// Skills

export interface SkillFormInput {
  name: string;
  routingTagIds: number[];
  routingDepartmentIds: number[];
  agents: Array<{ userId: UserId; proficiency: number }>;
}

/**
 * The skill form's fields. `known` says which tag, department and agent ids
 * exist, so an unknown one is a field error, as Laravel's `exists` rules.
 */
export function skillInput(
  body: any,
  known: {
    nameTaken: boolean;
    tagIds: Set<number>;
    departmentIds: Set<number>;
    agentIds: Set<string>;
  },
): SkillFormInput {
  const errors: Record<string, string> = {};
  let name = '';
  try {
    name = requiredName(body, 100);
  } catch (error) {
    Object.assign(errors, (error as UiValidationException).errors);
  }
  if (name && known.nameTaken) errors.name = 'The name has already been taken.';

  const ids = (key: 'routing_tag_ids' | 'routing_department_ids', valid: Set<number>) => {
    const raw = body?.[key] ?? [];
    if (!Array.isArray(raw)) {
      errors[key] = `The ${key} must be a list.`;
      return [];
    }
    const out: number[] = [];
    raw.forEach((value: unknown, i: number) => {
      const id = Number(value);
      if (!Number.isInteger(id) || !valid.has(id)) {
        errors[`${key}.${i}`] = `The selected ${key}.${i} is invalid.`;
      } else if (!out.includes(id)) {
        out.push(id);
      }
    });
    return out;
  };
  const routingTagIds = ids('routing_tag_ids', known.tagIds);
  const routingDepartmentIds = ids('routing_department_ids', known.departmentIds);

  const rawAgents = body?.agents ?? [];
  const agents: SkillFormInput['agents'] = [];
  if (!Array.isArray(rawAgents)) {
    errors.agents = 'The agents must be a list.';
  } else {
    const seen = new Set<string>();
    rawAgents.forEach((agent: any, i: number) => {
      const userId = agent?.user_id;
      const key = userId == null ? '' : String(userId);
      if (!key || typeof userId === 'object') {
        errors[`agents.${i}.user_id`] = 'The agent field is required.';
      } else if (!known.agentIds.has(key)) {
        errors[`agents.${i}.user_id`] = `The selected agents.${i}.user_id is not an agent.`;
      } else if (seen.has(key)) {
        errors[`agents.${i}.user_id`] = `The agents.${i}.user_id field has a duplicate value.`;
      }
      seen.add(key);
      const proficiency = Number(agent?.proficiency);
      if (!Number.isInteger(proficiency) || proficiency < 1 || proficiency > 5) {
        errors[`agents.${i}.proficiency`] = 'The proficiency must be between 1 and 5.';
      }
      agents.push({ userId, proficiency });
    });
  }

  if (Object.keys(errors).length) throw new UiValidationException(errors);
  return { name, routingTagIds, routingDepartmentIds, agents };
}

// Capacity

/** Laravel's AgentCapacity::loadPercentage(). */
export function loadPercentage(current: number, max: number): number {
  if (max <= 0) return 100;
  return Math.round((current / max) * 1000) / 10;
}

/**
 * A capacity row as Laravel's CapacityController maps it. This backend keeps
 * one limit per agent across channels, so the channel is always `default`
 * (Laravel's column default).
 */
export function serializeCapacity(
  capacity: AgentCapacity,
  userId: UserId | null,
  agentName: string | null,
) {
  return {
    id: capacity.id,
    user_id: userId,
    agent_name: agentName ?? 'Unknown',
    channel: 'default',
    max_concurrent: capacity.maxTickets,
    current_count: capacity.currentTickets,
    load_percentage: loadPercentage(capacity.currentTickets, capacity.maxTickets),
  };
}

export function capacityInput(body: any): number {
  const value = body?.max_concurrent;
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim() || NaN);
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new UiValidationException({
      max_concurrent: 'The max concurrent must be between 1 and 999.',
    });
  }
  return n;
}

// Audit log

/**
 * The audit log stores the verb the API was called with (`create`); the
 * screen filters and colours by Laravel's past tense (`created`).
 */
const PAST_TENSE: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
};

export const AUDIT_ACTIONS = ['created', 'updated', 'deleted'];

export function auditAction(stored: string): string {
  return PAST_TENSE[stored] ?? stored;
}

/** The stored verbs a screen filter value matches. */
export function storedAuditActions(filter: string): string[] {
  const verbs = Object.entries(PAST_TENSE)
    .filter(([, past]) => past === filter)
    .map(([verb]) => verb);
  return [...verbs, filter];
}

export function serializeAuditLog(log: AuditLog, directory: UserDirectory) {
  const user = log.userId != null ? directory.get(String(log.userId)) : undefined;
  return {
    id: log.id,
    user_id: log.userId ?? null,
    user: log.userId != null ? { id: log.userId, name: user?.name ?? `User #${log.userId}` } : null,
    action: auditAction(log.action),
    auditable_type: log.entityType,
    auditable_id: log.entityId ?? null,
    old_values: log.oldValues ?? null,
    new_values: log.newValues ?? null,
    ip_address: log.ipAddress ?? null,
    user_agent: log.userAgent ?? null,
    created_at: iso(log.createdAt),
  };
}
