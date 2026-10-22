import type { EscalationRule } from '../entities/escalation-rule.entity';

/**
 * The escalation rule contract the shared admin form posts (escalated-laravel's
 * EscalationRule): `conditions` and `actions` are lists of `{ field, value }`
 * and `{ type, value }`.
 *
 * Rules saved before this contract have an SLA policy, an SLA trigger and
 * `conditions` as an object; they are read by turning that shape into the
 * conditions below, so they keep matching the same tickets and the admin form
 * shows (and saves back) what they do.
 */

export interface RuleCondition {
  field: string;
  value: unknown;
}

export interface RuleAction {
  type: string;
  value: unknown;
}

/**
 * Condition fields: Laravel's, then this backend's for rules saved before the
 * contract (`sla_policy_id`, `first_response_breached`, `resolution_breached`,
 * `first_response_due_within_minutes`). Any other field is ignored, as in Laravel.
 */
export const ESCALATION_CONDITION_FIELDS = [
  'status',
  'priority',
  'assigned',
  'age_hours',
  'no_response_hours',
  'sla_breached',
  'department_id',
  'ticket_type',
  'account',
  'account_type',
  'account_id',
  'sla_policy_id',
  'first_response_breached',
  'resolution_breached',
  'first_response_due_within_minutes',
] as const;

/** Action types, as Laravel's EscalationService runs them. */
export const ESCALATION_ACTION_TYPES = [
  'escalate',
  'change_priority',
  'assign_to',
  'change_department',
] as const;

/** Action names used before the contract, and what they are now. */
const LEGACY_ACTIONS: Record<string, string> = {
  reassign: 'assign_to',
  set_priority: 'change_priority',
};

/** The SLA triggers rules had before the contract, as conditions. */
const LEGACY_TRIGGERS: Record<string, (rule: EscalationRule) => RuleCondition> = {
  first_response_breach: () => ({ field: 'first_response_breached', value: true }),
  resolution_breach: () => ({ field: 'resolution_breached', value: true }),
  approaching_breach: (rule) => ({
    field: 'first_response_due_within_minutes',
    value: rule.minutesBefore ?? 0,
  }),
};

export interface NormalizedEscalationRule {
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Saved before the contract: announces `ticket.escalated` itself, as it always has. */
  legacy: boolean;
}

/** A rule's conditions and actions in the contract's shape, whatever shape it was saved in. */
export function normalizeEscalationRule(
  rule: Pick<EscalationRule, 'conditions' | 'actions' | 'slaPolicyId' | 'triggerType'> &
    Partial<Pick<EscalationRule, 'minutesBefore'>>,
): NormalizedEscalationRule {
  const raw = rule.conditions;
  const legacy = !Array.isArray(raw);
  const conditions: RuleCondition[] = [];

  if (rule.slaPolicyId != null) {
    conditions.push({ field: 'sla_policy_id', value: rule.slaPolicyId });
  }
  if (legacy) {
    const trigger = LEGACY_TRIGGERS[rule.triggerType];
    if (trigger) conditions.push(trigger(rule as EscalationRule));
    if (raw && typeof raw === 'object') {
      for (const [field, value] of Object.entries(raw)) conditions.push({ field, value });
    }
  } else {
    for (const condition of raw) {
      if (!condition || typeof condition !== 'object') continue;
      const field = String((condition as any).field ?? '');
      if (field === 'sla_policy_id' && rule.slaPolicyId != null) continue;
      conditions.push({ field, value: (condition as any).value ?? null });
    }
  }

  const actions = (Array.isArray(rule.actions) ? rule.actions : [])
    .filter((action) => action && typeof action === 'object')
    .map((action) => ({
      type: LEGACY_ACTIONS[action.type] ?? String(action.type ?? ''),
      value: action.value ?? null,
    }));

  return { conditions, actions, legacy };
}
