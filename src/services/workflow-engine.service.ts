import { accountIdentity } from '../config/ticket-access';
import { Injectable } from '@nestjs/common';
import { WORKFLOW_TRIGGERS } from '../events/workflow-triggers';

export const OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'less_than',
  'greater_or_equal',
  'less_or_equal',
  'is_empty',
  'is_not_empty',
] as const;
/**
 * The actions WorkflowExecutorService performs: the contract's core catalog
 * plus `add_follower`. These, and only these, are offered to the builder.
 */
export const WORKFLOW_ACTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'change_status', label: 'Change Status' },
  { value: 'change_priority', label: 'Change Priority' },
  { value: 'add_tag', label: 'Add Tag' },
  { value: 'remove_tag', label: 'Remove Tag' },
  { value: 'set_department', label: 'Set Department' },
  { value: 'assign_agent', label: 'Assign Agent' },
  { value: 'add_note', label: 'Add Internal Note' },
  { value: 'insert_canned_reply', label: 'Insert Canned Reply' },
  { value: 'add_follower', label: 'Add Follower' },
];
export const ACTION_TYPES: readonly string[] = WORKFLOW_ACTIONS.map((action) => action.value);

/** Every trigger the package fires (the shared event vocabulary). */
export const TRIGGER_EVENTS: readonly string[] = WORKFLOW_TRIGGERS.map((trigger) => trigger.value);

/** Condition fields the engine evaluates (workflow-admin-contract.md, plus `account`). */
export const CONDITION_FIELDS = [
  'status',
  'priority',
  'ticket_type',
  'channel',
  'subject',
  'description',
  'tags',
  'department_id',
  'assigned_to',
  'hours_since_created',
  'hours_since_updated',
  'account',
] as const;

/** A ticket flattened for the engine: scalars as strings, `tags` as a list of names. */
export type ConditionMap = Record<string, string | string[]>;

interface Condition {
  field: string;
  operator: string;
  value: unknown;
}
interface ConditionGroup {
  all?: Condition[];
  any?: Condition[];
}

@Injectable()
export class WorkflowEngineService {
  evaluateConditions(conditions: ConditionGroup | Condition[], ticket: ConditionMap): boolean {
    if (!conditions) return true;
    if (Array.isArray(conditions)) return conditions.every((c) => this.evalSingle(c, ticket));
    if (conditions.all) return conditions.all.every((c) => this.evalSingle(c, ticket));
    if (conditions.any) return conditions.any.some((c) => this.evalSingle(c, ticket));
    return true;
  }

  evalSingle(c: Condition, ticket: ConditionMap): boolean {
    const aliases: Record<string, string> = {
      ticket_type: 'ticketType',
      account_type: 'accountType',
      account_id: 'accountId',
      department_id: 'departmentId',
      assigned_to: 'assigneeId',
    };
    if (c.field === 'account') {
      const actual = accountIdentity({
        type: ticket.accountType ?? ticket.account_type,
        id: ticket.accountId ?? ticket.account_id,
      });
      if (c.operator === 'is_empty') return actual === null;
      if (c.operator === 'is_not_empty') return actual !== null;
      const expected = accountIdentity(c.value);
      if (!expected || !['equals', 'not_equals'].includes(c.operator)) return false;
      const equal = !!actual && actual.type === expected.type && actual.id === expected.id;
      return c.operator === 'equals' ? equal : !equal;
    }
    const actual = ticket[c.field] ?? ticket[aliases[c.field]] ?? '';
    if (Array.isArray(actual)) return this.applyListOperator(c.operator, actual, c.value);
    return this.applyOperator(c.operator, actual, String(c.value ?? ''));
  }

  /**
   * A list field (`tags`): `contains`/`equals` mean the list has the value,
   * `not_contains`/`not_equals` that it does not, and `is_empty` that it has
   * none. Names compare case-insensitively.
   */
  applyListOperator(op: string, actual: string[], expected: unknown): boolean {
    const wanted = String(expected ?? '')
      .trim()
      .toLowerCase();
    const has = actual.some((item) => item.toLowerCase() === wanted);
    switch (op) {
      case 'equals':
      case 'contains':
        return has;
      case 'not_equals':
      case 'not_contains':
        return !has;
      case 'is_empty':
        return actual.length === 0;
      case 'is_not_empty':
        return actual.length > 0;
      default:
        return false;
    }
  }

  applyOperator(op: string, actual: string, expected: string): boolean {
    switch (op) {
      case 'equals':
        return actual === expected;
      case 'not_equals':
        return actual !== expected;
      case 'contains':
        return actual.includes(expected);
      case 'not_contains':
        return !actual.includes(expected);
      case 'starts_with':
        return actual.startsWith(expected);
      case 'ends_with':
        return actual.endsWith(expected);
      case 'greater_than':
        return Number(actual) > Number(expected);
      case 'less_than':
        return Number(actual) < Number(expected);
      case 'greater_or_equal':
        return Number(actual) >= Number(expected);
      case 'less_or_equal':
        return Number(actual) <= Number(expected);
      case 'is_empty':
        return !actual.trim();
      case 'is_not_empty':
        return !!actual.trim();
      default:
        return false;
    }
  }

  interpolateVariables(text: string, ticket: Record<string, string | string[]>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const value = ticket[varName];
      if (value === undefined) return match;
      return Array.isArray(value) ? value.join(', ') : value;
    });
  }

  dryRun(
    conditions: ConditionGroup,
    actions: Array<{ type: string; value?: string }>,
    ticket: ConditionMap,
  ) {
    const matched = this.evaluateConditions(conditions, ticket);
    return {
      matched,
      actions: actions.map((a) => ({
        type: a.type,
        value: this.interpolateVariables(a.value ?? '', ticket),
        would_execute: matched,
      })),
    };
  }
}
