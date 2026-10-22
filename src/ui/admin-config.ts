import type { Repository } from 'typeorm';
import type { BusinessSchedule } from '../entities/business-schedule.entity';
import type { CannedResponse } from '../entities/canned-response.entity';
import type { EscalationRule } from '../entities/escalation-rule.entity';
import type { Macro } from '../entities/macro.entity';
import type { SlaPolicy } from '../entities/sla-policy.entity';
import type { TicketStatus } from '../entities/ticket-status.entity';
import { isStatusCategory, STATUS_CATEGORIES, statusCategory } from '../entities/status-category';
import type { Webhook } from '../entities/webhook.entity';
import type { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { countsBusinessHours } from '../services/business-hours';
import { normalizeEscalationRule } from '../services/escalation-rules';
import { webhookEventNames } from '../services/webhook.service';
import { UiValidationException } from './inertia.interceptor';
import { iso, person, type UserDirectory } from './serializers';

/**
 * The admin configuration screens' shapes and form input, as
 * escalated-laravel's SlaPolicy, Macro, CannedResponse, Status and Webhook
 * admin controllers send and validate them, mapped onto this package's
 * entities.
 */

/** The priorities this backend has SLA targets for. */
export const SLA_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const FIRST_RESPONSE: Record<string, keyof SlaPolicy> = {
  low: 'firstResponseLow',
  medium: 'firstResponseMedium',
  high: 'firstResponseHigh',
  urgent: 'firstResponseUrgent',
};
const RESOLUTION: Record<string, keyof SlaPolicy> = {
  low: 'resolutionLow',
  medium: 'resolutionMedium',
  high: 'resolutionHigh',
  urgent: 'resolutionUrgent',
};

/** Minutes as the screen's hours, keeping fractions (90 minutes is 1.5). */
function hours(minutes: number | null | undefined): number | null {
  return minutes == null ? null : Math.round((minutes / 60) * 100) / 100;
}

function flag(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  throw new UiValidationException({
    [field]: `The ${field.replace(/_/g, ' ')} field must be true or false.`,
  });
}

function requiredText(value: unknown, field: string, max = 255): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UiValidationException({ [field]: `The ${field} field is required.` });
  }
  if (value.length > max) {
    throw new UiValidationException({
      [field]: `The ${field} may not be greater than ${max} characters.`,
    });
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

// SLA policies

export function serializeSlaPolicy(policy: SlaPolicy, ticketsCount = 0) {
  const byPriority = (columns: Record<string, keyof SlaPolicy>) =>
    Object.fromEntries(
      SLA_PRIORITIES.map((p) => [p, hours(policy[columns[p]] as unknown as number)]),
    );
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description ?? null,
    first_response_hours: byPriority(FIRST_RESPONSE),
    resolution_hours: byPriority(RESOLUTION),
    business_hours_only: countsBusinessHours(policy),
    business_schedule_id: policy.businessScheduleId ?? null,
    is_default: policy.isDefault === true,
    is_active: policy.isActive !== false,
    tickets_count: ticketsCount,
    created_at: iso(policy.createdAt),
    updated_at: iso(policy.updatedAt),
  };
}

/**
 * The `schedules` prop of the SLA policy and department forms: every business
 * schedule as `{id, name}`, by name, for the shared **Business hours
 * schedule** picker (as escalated-laravel's controllers pass it).
 */
export async function scheduleOptions(
  schedules: Repository<BusinessSchedule>,
): Promise<Array<{ id: number; name: string }>> {
  const rows = await schedules.find({ select: { id: true, name: true }, order: { name: 'ASC' } });
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * `business_schedule_id` from a form, when it sends one: a positive id, or
 * null to clear it. Undefined when the key is not sent, so a form that does
 * not know about schedules leaves the stored one alone.
 */
export function scheduleReference(body: any): number | null | undefined {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'business_schedule_id'))
    return undefined;
  const value = body.business_schedule_id;
  if (value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new UiValidationException({
      business_schedule_id: 'The selected business schedule is invalid.',
    });
  }
  return id;
}

/**
 * The SLA form's fields in the entity's names. Hours become minutes. With
 * `business_hours_only`, deadlines count in the policy's own schedule
 * (`business_schedule_id`, changed only when sent), else the ticket
 * department's, else the default one. `anySchedule` says whether one exists
 * to count against.
 */
export function slaPolicyInput(
  body: any,
  existing: SlaPolicy | null,
  anySchedule: number | null,
): Partial<SlaPolicy> {
  const input: Partial<SlaPolicy> = {
    name: requiredText(body?.name, 'name'),
    description: optionalText(body?.description) as string,
    isDefault: flag(body?.is_default, 'is_default', false),
    isActive: flag(body?.is_active, 'is_active', true),
  };

  for (const [field, columns] of [
    ['first_response_hours', FIRST_RESPONSE],
    ['resolution_hours', RESOLUTION],
  ] as const) {
    const given = body?.[field] ?? {};
    if (typeof given !== 'object' || Array.isArray(given)) {
      throw new UiValidationException({ [field]: `The ${field.replace(/_/g, ' ')} are invalid.` });
    }
    for (const priority of SLA_PRIORITIES) {
      const value = given[priority];
      if (value === undefined || value === null || value === '') continue;
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) {
        throw new UiValidationException({
          [`${field}.${priority}`]: `The ${priority} target must be a positive number of hours.`,
        });
      }
      (input as any)[columns[priority]] = Math.max(1, Math.round(number * 60));
    }
  }

  const sent = scheduleReference(body);
  if (flag(body?.business_hours_only, 'business_hours_only', false)) {
    const own = sent !== undefined ? sent : (existing?.businessScheduleId ?? null);
    if (own == null && anySchedule == null) {
      throw new UiValidationException({
        business_hours_only: 'Add business hours before limiting a policy to them.',
      });
    }
    input.businessHoursOnly = true;
    if (sent !== undefined) input.businessScheduleId = sent as number;
  } else {
    input.businessHoursOnly = false;
    input.businessScheduleId = null as unknown as number;
  }
  return input;
}

// Macros

export const MACRO_ACTION_TYPES = [
  'status',
  'priority',
  'assign',
  'tags',
  'department',
  'reply',
  'note',
] as const;

export function serializeMacro(macro: Macro, directory: UserDirectory) {
  const creator = person(directory, macro.createdBy);
  return {
    id: macro.id,
    name: macro.name,
    description: macro.description ?? null,
    actions: (macro.actions ?? []).map((action, index) => ({
      type: action.type,
      value: action.value ?? '',
      order: action.order ?? index,
    })),
    is_shared: macro.scope !== 'personal',
    is_active: macro.isActive !== false,
    usage_count: macro.usageCount ?? 0,
    created_by: macro.createdBy ?? null,
    creator: creator ? { id: creator.id, name: creator.name } : null,
    created_at: iso(macro.createdAt),
    updated_at: iso(macro.updatedAt),
  };
}

export function macroInput(body: any): Partial<Macro> {
  const actions = body?.actions ?? [];
  if (!Array.isArray(actions)) {
    throw new UiValidationException({ actions: 'The actions must be a list.' });
  }
  const cleaned = actions.map((action: any, index: number) => {
    if (!MACRO_ACTION_TYPES.includes(action?.type)) {
      throw new UiValidationException({
        [`actions.${index}.type`]: 'The selected action type is invalid.',
      });
    }
    const value = action.value;
    if (value === undefined || value === null || value === '') {
      throw new UiValidationException({ [`actions.${index}.value`]: 'The value is required.' });
    }
    return { type: action.type, value, order: index };
  });
  return {
    name: requiredText(body?.name, 'name'),
    description: optionalText(body?.description) as string,
    scope: flag(body?.is_shared, 'is_shared', false) ? 'shared' : 'personal',
    actions: cleaned,
  };
}

// Canned responses

export function serializeCannedResponse(response: CannedResponse, directory: UserDirectory) {
  const creator = person(directory, response.createdBy);
  return {
    id: response.id,
    title: response.title,
    body: response.content,
    short_code: response.shortCode ?? null,
    // Not stored by this backend; the screen hides the badge when null.
    category: null,
    is_shared: response.scope !== 'personal',
    department_id: response.departmentId ?? null,
    created_by: response.createdBy ?? null,
    creator: creator ? { id: creator.id, name: creator.name } : null,
    created_at: iso(response.createdAt),
    updated_at: iso(response.updatedAt),
  };
}

/**
 * The canned response form's fields. The shared screen has no short code
 * field; a new response gets one made from its title (`creating`), and an
 * edit keeps the one it has unless `short_code` is sent.
 */
export function cannedResponseInput(body: any, creating = false): Partial<CannedResponse> {
  const title = requiredText(body?.title, 'title');
  const given = typeof body?.short_code === 'string' ? slugify(body.short_code) : '';
  return {
    title,
    content: requiredText(body?.body, 'body', 65535),
    scope: flag(body?.is_shared, 'is_shared', true) ? 'shared' : 'personal',
    ...(given || creating ? { shortCode: given || slugify(title) || 'response' } : {}),
  };
}

// Statuses

/** escalated-laravel's status categories; lifecycle keys off them (`status-category.ts`). */
export { STATUS_CATEGORIES };

/**
 * A status as the Statuses screens read it: escalated-laravel's columns, plus
 * `name` and `is_closed` for clients of earlier releases.
 */
export function serializeStatus(status: TicketStatus) {
  const category = statusCategory(status);
  return {
    id: status.id,
    label: status.name,
    name: status.name,
    slug: status.slug,
    category,
    color: status.color ?? '#6b7280',
    description: status.description ?? null,
    position: status.sortOrder ?? 0,
    is_default: status.isDefault === true,
    is_system: status.isSystem === true,
    is_closed: category === 'solved',
    created_at: iso(status.createdAt),
    updated_at: iso(status.updatedAt),
  };
}

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

/**
 * escalated-laravel's status validation: `label` (at most 100 characters, the
 * column's size here), `category` one of the five, `color`, optional
 * `description`, integer `position`, boolean `is_default`.
 */
export function statusInput(body: any): Partial<TicketStatus> {
  const label = requiredText(body?.label, 'label', 100);
  const category = body?.category;
  if (!isStatusCategory(category)) {
    throw new UiValidationException({ category: 'The selected category is invalid.' });
  }
  const color = requiredText(body?.color, 'color', 20);
  const position = body?.position == null || body.position === '' ? 0 : Number(body.position);
  if (!Number.isInteger(position)) {
    throw new UiValidationException({ position: 'The position must be an integer.' });
  }
  const description = body?.description;
  if (description != null && typeof description !== 'string') {
    throw new UiValidationException({ description: 'The description must be a string.' });
  }
  return {
    name: label,
    category,
    isClosed: category === 'solved',
    color,
    description: description?.trim() ? description : null,
    sortOrder: position,
    isDefault: flag(body?.is_default, 'is_default', false),
  };
}

// Webhooks

/** The event names webhooks are sent under (the Webhooks form's checkboxes). */
export function availableWebhookEvents(): string[] {
  return webhookEventNames();
}

export function serializeWebhook(
  webhook: Webhook,
  latest: WebhookDelivery | null = null,
  deliveriesCount = 0,
) {
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    events: webhook.events ?? [],
    secret: webhook.secret ?? null,
    active: webhook.isActive !== false,
    failure_count: webhook.failureCount ?? 0,
    last_delivered_at: iso(webhook.lastDeliveredAt),
    deliveries_count: deliveriesCount,
    deliveries: latest ? [serializeDelivery(latest)] : [],
    created_at: iso(webhook.createdAt),
    updated_at: iso(webhook.updatedAt),
  };
}

export function serializeDelivery(delivery: WebhookDelivery) {
  let payload: unknown = delivery.payload;
  try {
    payload = JSON.parse(delivery.payload);
  } catch {
    // Shown as stored.
  }
  return {
    id: delivery.id,
    webhook_id: delivery.webhookId,
    event: delivery.event,
    payload,
    response_code: delivery.responseStatus ?? null,
    response_body: delivery.responseBody ?? null,
    status: delivery.status,
    attempts: delivery.attempts ?? 0,
    next_retry_at: iso(delivery.nextRetryAt),
    created_at: iso(delivery.createdAt),
  };
}

export function webhookInput(body: any): Partial<Webhook> {
  const url = requiredText(body?.url, 'url', 500);
  const events = body?.events;
  if (!Array.isArray(events) || !events.length || events.some((e) => typeof e !== 'string')) {
    throw new UiValidationException({ events: 'Choose at least one event.' });
  }
  const secret = body?.secret;
  if (secret != null && (typeof secret !== 'string' || secret.length > 255)) {
    throw new UiValidationException({
      secret: 'The secret may not be greater than 255 characters.',
    });
  }
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {
    // The URL check in the webhook service reports it.
  }
  return {
    name: host.slice(0, 255),
    url,
    events,
    ...(typeof secret === 'string' && secret ? { secret } : {}),
    isActive: flag(body?.active, 'active', true),
  };
}

// Escalation rules

/** A rule as escalated-laravel's EscalationRule model serializes it. */
export function serializeEscalationRule(rule: EscalationRule) {
  const { conditions, actions } = normalizeEscalationRule(rule);
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? null,
    trigger_type: rule.triggerType,
    conditions,
    actions,
    order: rule.sortOrder ?? 0,
    is_active: rule.isActive !== false,
    repeat_after_hours: rule.repeatAfterHours ?? null,
    // Not stored by this backend; the screen groups such rules as Uncategorized.
    category: null,
    created_at: iso(rule.createdAt),
    updated_at: iso(rule.updatedAt),
  };
}

function list(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.length) {
    throw new UiValidationException({ [field]: `The ${field} field is required.` });
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new UiValidationException({ [`${field}.${index}`]: `The ${field} are invalid.` });
    }
    return item as Record<string, unknown>;
  });
}

/**
 * The escalation rule form's fields (Laravel's StoreEscalationRuleRequest).
 * A rule saved here carries everything in its conditions, so it has no SLA
 * policy of its own: a rule saved before the contract shows its policy as an
 * `sla_policy_id` condition, which saving keeps.
 */
export function escalationRuleInput(body: any): Partial<EscalationRule> {
  const conditions = list(body?.conditions, 'conditions').map((condition) => ({
    field: typeof condition.field === 'string' ? condition.field : '',
    value: condition.value ?? null,
  }));
  const actions = list(body?.actions, 'actions').map((action) => ({
    type: typeof action.type === 'string' ? action.type : '',
    value: action.value ?? null,
  }));

  const order = body?.order == null || body.order === '' ? 0 : Number(body.order);
  if (!Number.isInteger(order)) {
    throw new UiValidationException({ order: 'The order must be an integer.' });
  }
  const repeat = body?.repeat_after_hours;
  let repeatAfterHours: number | null = null;
  if (repeat !== undefined && repeat !== null && repeat !== '') {
    repeatAfterHours = Number(repeat);
    if (!Number.isInteger(repeatAfterHours) || repeatAfterHours < 1 || repeatAfterHours > 8760) {
      throw new UiValidationException({
        repeat_after_hours: 'The repeat after hours must be between 1 and 8760.',
      });
    }
  }

  return {
    name: requiredText(body?.name, 'name'),
    description: optionalText(body?.description),
    triggerType: requiredText(body?.trigger_type, 'trigger_type', 50),
    conditions,
    actions,
    sortOrder: order,
    isActive: flag(body?.is_active, 'is_active', true),
    repeatAfterHours,
    slaPolicyId: null,
    minutesBefore: 0,
  };
}
