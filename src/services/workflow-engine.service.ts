import { Injectable } from '@nestjs/common';

export const OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal', 'is_empty', 'is_not_empty'] as const;
export const ACTION_TYPES = ['change_status', 'assign_agent', 'change_priority', 'add_tag', 'remove_tag', 'set_department', 'add_note', 'send_webhook', 'set_type', 'delay', 'add_follower', 'send_notification'] as const;
export const TRIGGER_EVENTS = ['ticket.created', 'ticket.updated', 'ticket.status_changed', 'ticket.assigned', 'ticket.priority_changed', 'ticket.tagged', 'ticket.department_changed', 'reply.created', 'reply.agent_reply', 'sla.warning', 'sla.breached', 'ticket.reopened'] as const;

interface Condition { field: string; operator: string; value: string; }
interface ConditionGroup { all?: Condition[]; any?: Condition[]; }

@Injectable()
export class WorkflowEngineService {
  evaluateConditions(conditions: ConditionGroup | Condition[], ticket: Record<string, string>): boolean {
    if (Array.isArray(conditions)) return conditions.every(c => this.evalSingle(c, ticket));
    if (conditions.all) return conditions.all.every(c => this.evalSingle(c, ticket));
    if (conditions.any) return conditions.any.some(c => this.evalSingle(c, ticket));
    return true;
  }

  evalSingle(c: Condition, ticket: Record<string, string>): boolean {
    const actual = ticket[c.field] ?? '';
    return this.applyOperator(c.operator, actual, c.value);
  }

  applyOperator(op: string, actual: string, expected: string): boolean {
    switch (op) {
      case 'equals': return actual === expected;
      case 'not_equals': return actual !== expected;
      case 'contains': return actual.includes(expected);
      case 'not_contains': return !actual.includes(expected);
      case 'starts_with': return actual.startsWith(expected);
      case 'ends_with': return actual.endsWith(expected);
      case 'greater_than': return Number(actual) > Number(expected);
      case 'less_than': return Number(actual) < Number(expected);
      case 'greater_or_equal': return Number(actual) >= Number(expected);
      case 'less_or_equal': return Number(actual) <= Number(expected);
      case 'is_empty': return !actual.trim();
      case 'is_not_empty': return !!actual.trim();
      default: return false;
    }
  }

  interpolateVariables(text: string, ticket: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => ticket[varName] ?? match);
  }

  dryRun(conditions: ConditionGroup, actions: Array<{ type: string; value?: string }>, ticket: Record<string, string>) {
    const matched = this.evaluateConditions(conditions, ticket);
    return { matched, actions: actions.map(a => ({ type: a.type, value: this.interpolateVariables(a.value ?? '', ticket), would_execute: matched })) };
  }
}
