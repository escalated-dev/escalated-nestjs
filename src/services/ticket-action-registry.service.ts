import { Injectable } from '@nestjs/common';
import {
  TicketAction,
  TicketActionConfig,
  TicketActionValueOrFn,
  isTicketAction,
} from '../contracts/ticket-action.interface';

/**
 * Wraps a plain {@link TicketActionConfig} object so it satisfies the
 * {@link TicketAction} interface, resolving value-or-function fields lazily.
 */
export class ArrayTicketAction implements TicketAction {
  constructor(private readonly config: TicketActionConfig) {
    if (!config.key || !config.label) {
      throw new Error('Ticket actions require both "key" and "label" values.');
    }
  }

  key(): string {
    return String(this.config.key);
  }

  label(ticket: any, user: any): string {
    return String(this.resolve(this.config.label, ticket, user));
  }

  visible(ticket: any, user: any): boolean {
    return Boolean(this.resolve(this.config.visible ?? true, ticket, user));
  }

  enabled(ticket: any, user: any): boolean {
    return Boolean(this.resolve(this.config.enabled ?? true, ticket, user));
  }

  variant(): string {
    return this.config.variant ?? 'secondary';
  }

  confirmation(ticket: any, user: any): string | null {
    const value = this.resolve(this.config.confirmation ?? null, ticket, user);
    return value === null || value === undefined ? null : String(value);
  }

  metadata(ticket: any, user: any): Record<string, any> {
    const value = this.resolve(this.config.metadata ?? {}, ticket, user);
    return value && typeof value === 'object' ? value : {};
  }

  private resolve<T>(value: TicketActionValueOrFn<T>, ticket: any, user: any): T {
    return typeof value === 'function'
      ? (value as (ticket: any, user: any) => T)(ticket, user)
      : value;
  }
}

/**
 * Holds the host application's registered custom ticket actions and resolves
 * which ones are available for a given ticket/user. Registered from
 * `options.ticketActions.actions` at module bootstrap.
 */
@Injectable()
export class TicketActionRegistry {
  private readonly actions = new Map<string, TicketAction>();

  register(action: TicketAction | TicketActionConfig): this {
    const resolved = isTicketAction(action) ? action : new ArrayTicketAction(action);
    this.actions.set(resolved.key(), resolved);
    return this;
  }

  find(key: string): TicketAction | null {
    return this.actions.get(key) ?? null;
  }

  /**
   * Returns the actions visible to this ticket/user, serialized for the UI.
   * The controller adds the `url` and `method` before sending to the client.
   */
  forTicket(ticket: any, user: any): Array<Record<string, any>> {
    const result: Array<Record<string, any>> = [];

    for (const action of this.actions.values()) {
      if (!action.visible(ticket, user)) {
        continue;
      }

      result.push({
        key: action.key(),
        label: action.label(ticket, user),
        variant: action.variant(),
        confirmation: action.confirmation(ticket, user),
        disabled: !action.enabled(ticket, user),
        metadata: action.metadata(ticket, user),
      });
    }

    return result;
  }
}
