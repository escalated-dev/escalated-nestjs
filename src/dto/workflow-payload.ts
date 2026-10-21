import { canonicalEvent } from '../events/event-names';
import { ACTION_TYPES, TRIGGER_EVENTS } from '../services/workflow-engine.service';

/**
 * The create/update body the shared admin UI sends for a Workflow, as fixed in
 * escalated-developer-context `domain-model/workflow-admin-contract.md`:
 * top-level `name`, `description`, `trigger_event`, `conditions` and
 * `actions`, with conditions as `{all: [...]}` or `{any: [...]}` and actions
 * as `{type, value}`.
 */

export interface WorkflowCondition {
  field: string;
  operator: string;
  value?: string | number | boolean | null;
}

export type WorkflowConditions = { all: WorkflowCondition[] } | { any: WorkflowCondition[] };

export interface WorkflowActionPayload {
  type: string;
  value: string;
}

export interface WorkflowPayload {
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: WorkflowConditions;
  actions: WorkflowActionPayload[];
  is_active: boolean;
}

/** Field name to messages, the shape a 422 response carries. */
export type WorkflowValidationErrors = Record<string, string[]>;

export type WorkflowPayloadResult =
  { ok: true; data: WorkflowPayload } | { ok: false; errors: WorkflowValidationErrors };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown) =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return !['false', '0', ''].includes(value.toLowerCase());
  return Boolean(value);
}

export function validateWorkflowPayload(input: unknown): WorkflowPayloadResult {
  const body = isPlainObject(input) ? input : {};
  const errors: WorkflowValidationErrors = {};
  const fail = (field: string, message: string) => (errors[field] ??= []).push(message);

  const name = body.name;
  if (!isNonEmptyString(name)) fail('name', 'Give the workflow a name.');
  else if (name.trim().length > 255) fail('name', 'The name may be at most 255 characters.');

  const description = body.description;
  if (description !== undefined && description !== null && typeof description !== 'string') {
    fail('description', 'The description must be text.');
  }

  // A legacy name (ADR 2026-10-21) is accepted and stored as its canonical name.
  const trigger = isNonEmptyString(body.trigger_event)
    ? canonicalEvent(body.trigger_event.trim())
    : null;
  if (!trigger) fail('trigger_event', 'Choose the event that triggers this workflow.');
  else if (!TRIGGER_EVENTS.includes(trigger)) {
    fail('trigger_event', `"${trigger}" is not an event this backend fires.`);
  }

  // Omitted conditions mean "every ticket".
  let conditions: WorkflowConditions = { all: [] };
  if (body.conditions !== undefined && body.conditions !== null) {
    const keys = isPlainObject(body.conditions) ? Object.keys(body.conditions) : [];
    const group = keys.length === 1 && (keys[0] === 'all' || keys[0] === 'any') ? keys[0] : null;
    const list = group ? (body.conditions as Record<string, unknown>)[group] : undefined;
    const valid =
      Array.isArray(list) &&
      list.every(
        (c) =>
          isPlainObject(c) &&
          isNonEmptyString(c.field) &&
          isNonEmptyString(c.operator) &&
          (c.value === undefined || isScalar(c.value)),
      );
    if (!group) {
      fail('conditions', 'Conditions must be grouped under exactly one of "all" or "any".');
    } else if (!valid) {
      fail('conditions', 'Every condition needs a field and an operator, and a single value.');
    } else {
      conditions = (group === 'all'
        ? { all: list }
        : { any: list }) as unknown as WorkflowConditions;
    }
  }

  const actions = body.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    fail('actions', 'Add at least one action.');
  } else if (
    !actions.every(
      (a) =>
        isPlainObject(a) &&
        isNonEmptyString(a.type) &&
        (a.value === undefined || isScalar(a.value)),
    )
  ) {
    fail('actions', 'Every action needs a type, and a single value.');
  } else {
    const unknown = actions.map((a) => a.type as string).filter((t) => !ACTION_TYPES.includes(t));
    if (unknown.length) {
      fail('actions', `Unsupported action: ${[...new Set(unknown)].join(', ')}.`);
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name: (name as string).trim(),
      description: isNonEmptyString(description) ? description : null,
      trigger_event: trigger as string,
      conditions,
      actions: (actions as Array<Record<string, unknown>>).map((a) => ({
        type: a.type as string,
        value: a.value === undefined || a.value === null ? '' : String(a.value),
      })),
      is_active: readBoolean(body.is_active, true),
    },
  };
}
