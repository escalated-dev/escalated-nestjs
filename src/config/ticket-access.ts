import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { DataSource, QueryBuilder, ObjectLiteral, EntityMetadata } from 'typeorm';
import { Observable } from 'rxjs';
import type { EscalatedModuleOptions } from './escalated.config';
import type { UserId } from './user-id-column';
import { Ticket } from '../entities/ticket.entity';

export interface AccountIdentity {
  type: string;
  id: string | number;
}
export interface AccountReference extends AccountIdentity {
  kind: 'requester' | 'subject' | 'agent';
}
export interface TicketActor {
  id: UserId;
  isAgent: boolean;
  isAdmin: boolean;
  account?: AccountIdentity | null;
}

export function accountIdentity(value: unknown): { type: string; id: string } | null {
  if (!value || typeof value !== 'object') return null;
  const { type, id } = value as AccountIdentity;
  if (
    typeof type !== 'string' ||
    !type ||
    !['string', 'number'].includes(typeof id) ||
    String(id) === ''
  )
    return null;
  return { type, id: String(id) };
}

export function validateTicketAccess(options: EscalatedModuleOptions): void {
  if (!['all', 'department'].includes(options.visibility ?? 'all'))
    throw new Error('visibility must be all or department');
  if (
    (options.visibility === 'department' || options.accounts?.scopeAgents) &&
    !options.ticketAccess?.resolveUser
  ) {
    throw new Error('Restricted ticket access requires ticketAccess.resolveUser');
  }
  if (options.accounts?.scopeAgents && (!options.accounts.enabled || !options.accounts.resolver)) {
    throw new Error('Account visibility requires enabled accounts and a resolver');
  }
}

const connections = new WeakMap<DataSource, TicketAccess>();
let installed = false;

/** Adds an AND predicate at SQL generation, after callers have supplied their WHERE.
 * This covers repository reads/writes, aggregates, eager joins and query-builder clones.
 * Registration is per DataSource; unrelated host connections are untouched.
 */
function installQueryScope(): void {
  if (installed) return;
  installed = true;
  const prototype = QueryBuilder.prototype as any;
  const originalParameters = prototype.getParameters;
  prototype.getParameters = function (this: QueryBuilder<ObjectLiteral>) {
    connections.get(this.connection)?.predicate(this);
    return originalParameters.call(this);
  };
  const original = prototype.createWhereExpression;
  prototype.createWhereExpression = function (this: QueryBuilder<ObjectLiteral>): string {
    const access = connections.get(this.connection);
    const predicate = access?.predicate(this);
    if (!predicate) return original.call(this);
    const map = this.expressionMap;
    const previous = map.extraAppendedAndWhereCondition;
    map.extraAppendedAndWhereCondition = previous ? `(${previous}) AND (${predicate})` : predicate;
    try {
      return original.call(this);
    } finally {
      map.extraAppendedAndWhereCondition = previous;
    }
  };
}

export class TicketAccess {
  private readonly context = new AsyncLocalStorage<TicketActor | null>();

  constructor(
    readonly source: DataSource,
    readonly options: EscalatedModuleOptions,
  ) {
    validateTicketAccess(options);
    connections.set(source, this);
    installQueryScope();
  }

  enabled(): boolean {
    return this.options.visibility === 'department' || !!this.options.accounts?.scopeAgents;
  }
  currentActor(): TicketActor | null {
    return this.context.getStore() ?? null;
  }
  withActor<T>(actor: TicketActor | null, work: () => T): T {
    return this.context.run(actor, work);
  }
  restricted(actor = this.currentActor()): boolean {
    return this.enabled() && !!actor?.isAgent && !actor.isAdmin;
  }

  async resolveUser(id: UserId): Promise<TicketActor | null> {
    const actor = await this.options.ticketAccess?.resolveUser(id);
    if (
      !actor ||
      typeof actor.isAgent !== 'boolean' ||
      typeof actor.isAdmin !== 'boolean' ||
      String(actor.id) !== String(id)
    ) {
      throw new Error(
        'ticketAccess.resolveUser must return the requested user with explicit isAgent/isAdmin flags',
      );
    }
    if (this.options.accounts?.scopeAgents && actor.isAgent && !actor.isAdmin) {
      return { ...actor, account: await this.resolveAccount({ kind: 'agent', type: 'User', id }) };
    }
    return actor;
  }

  async resolveAccount(reference: AccountReference): Promise<{ type: string; id: string } | null> {
    if (!this.options.accounts?.enabled || !this.options.accounts.resolver) return null;
    const value = await this.options.accounts.resolver(reference);
    if (value == null) return null;
    const identity = accountIdentity(value);
    if (!identity)
      throw new Error('Account resolver must return a complete type/id identity or null');
    return identity;
  }

  async requestActor(request: any): Promise<TicketActor | null> {
    if (!this.enabled()) return null;
    const user = this.options.userResolver?.(request) ?? request.user;
    const id = request.apiUserId ?? user?.id;
    return id == null ? null : this.resolveUser(id);
  }

  async allows(actor: TicketActor | null, ticket: Ticket): Promise<boolean> {
    if (!this.restricted(actor)) return true;
    return this.withActor(actor, () =>
      this.source.getRepository(Ticket).existsBy({ id: ticket.id }),
    );
  }

  async allowsAgent(id: UserId, ticket: Ticket): Promise<boolean> {
    if (!this.enabled()) return true;
    const actor = await this.resolveUser(id);
    return !!actor && (actor.isAgent || actor.isAdmin) && this.allows(actor, ticket);
  }

  async allowsUser(id: UserId, ticket: Ticket): Promise<boolean> {
    if (!this.enabled()) return true;
    return this.allows(await this.resolveUser(id), ticket);
  }

  predicate(query: QueryBuilder<ObjectLiteral>): string | null {
    const actor = this.currentActor();
    if (!this.restricted(actor)) return null;
    query.expressionMap.cache = false;
    const aliases = query.expressionMap.aliases.filter((alias) => alias.hasMetadata);
    const clauses: string[] = [];
    for (const alias of aliases) {
      const metadata = alias.metadata;
      if (!metadata.tableName.includes('escalated_')) continue;
      const prefix = query.expressionMap.aliasNamePrefixingEnabled
        ? `${query.escape(alias.name)}.`
        : '';
      const column = (property: string) =>
        prefix + query.escape(metadata.findColumnWithPropertyName(property)!.databaseName);
      if (metadata.target === Ticket) clauses.push(this.ticketPredicate(query, actor!, column));
      else if (alias.name === query.expressionMap.mainAlias?.name) {
        const fields = new Set(['ticketId', 'parentTicketId', 'childTicketId', 'linkedTicketId']);
        for (const relation of metadata.relations) {
          if (relation.inverseEntityMetadata.target === Ticket) {
            for (const joined of relation.joinColumns) fields.add(joined.propertyName);
          }
        }
        for (const field of fields) {
          if (!metadata.findColumnWithPropertyName(field)) continue;
          const ticketMatch = `${column(field)} IN (${this.visibleTickets(query, actor!)})`;
          if (metadata.name === 'Attachment' && field === 'ticketId') {
            clauses.push(
              `(${ticketMatch}) OR (${column(field)} IS NULL AND ${column('replyId')} IN (${this.visibleChildren(query, actor!, 'Reply')}))`,
            );
          } else clauses.push(ticketMatch);
        }
        if (metadata.findColumnWithPropertyName('sideConversationId'))
          clauses.push(
            `${column('sideConversationId')} IN (${this.visibleChildren(query, actor!, 'SideConversation')})`,
          );
        if (metadata.name === 'CustomFieldValue')
          clauses.push(
            `${column('entityType')} <> 'ticket' OR ${column('entityId')} IN (${this.visibleTickets(query, actor!)})`,
          );
      }
    }
    return clauses.length ? clauses.map((clause) => `(${clause})`).join(' AND ') : null;
  }

  private visibleChildren(
    query: QueryBuilder<ObjectLiteral>,
    actor: TicketActor,
    entity: string,
  ): string {
    const metadata = this.source.getMetadata(entity);
    return `SELECT ${query.escape(metadata.primaryColumns[0].databaseName)} FROM ${this.table(query, metadata)} WHERE ${query.escape(metadata.findColumnWithPropertyName('ticketId')!.databaseName)} IN (${this.visibleTickets(query, actor)})`;
  }

  private visibleTickets(query: QueryBuilder<ObjectLiteral>, actor: TicketActor): string {
    const metadata = this.source.getMetadata(Ticket);
    const alias = query.escape('__visible_ticket');
    const column = (property: string) =>
      `${alias}.${query.escape(metadata.findColumnWithPropertyName(property)!.databaseName)}`;
    return `SELECT ${column('id')} FROM ${this.table(query, metadata)} ${alias} WHERE ${this.ticketPredicate(query, actor, column)}`;
  }

  private table(query: QueryBuilder<ObjectLiteral>, metadata: EntityMetadata): string {
    return metadata.tablePath
      .split('.')
      .map((part) => query.escape(part))
      .join('.');
  }

  private ticketPredicate(
    query: QueryBuilder<ObjectLiteral>,
    actor: TicketActor,
    column: (property: string) => string,
  ): string {
    const predicates: string[] = [];
    if (this.options.visibility === 'department') {
      const profile = this.source.getMetadata('AgentProfile');
      const relation = profile.relations.find((item) => item.propertyName === 'departments')!;
      const junction = relation.junctionEntityMetadata!;
      const departmentColumn = relation.inverseJoinColumns[0].databaseName;
      const profileColumn = relation.joinColumns[0].databaseName;
      const quote = (value: string) => query.escape(value);
      query.setParameter('__accessUser', actor.id);
      predicates.push(
        `${column('departmentId')} IN (SELECT ad.${quote(departmentColumn)} FROM ${this.table(query, junction)} ad JOIN ${this.table(query, profile)} ap ON ap.${quote(profile.primaryColumns[0].databaseName)} = ad.${quote(profileColumn)} WHERE ap.${quote(profile.findColumnWithPropertyName('userId')!.databaseName)} = :__accessUser)`,
      );
    }
    if (this.options.accounts?.scopeAgents) {
      const account = accountIdentity(actor.account);
      if (!account) return '1 = 0';
      for (const [property, value] of [
        ['accountType', account.type],
        ['accountId', account.id],
      ]) {
        const parameter = `__access_${property}`;
        query.setParameter(parameter, value);
        predicates.push(caseSensitiveEquals(this.source, column(property), `:${parameter}`));
      }
    }
    return predicates.join(' AND ') || '1 = 1';
  }
}

export function caseSensitiveEquals(source: DataSource, column: string, parameter: string): string {
  if (['mysql', 'mariadb'].includes(source.options.type))
    return `${column} = ${parameter} AND BINARY ${column} = BINARY ${parameter}`;
  if (source.options.type === 'postgres') return `${column} COLLATE "C" = ${parameter}`;
  return `${column} COLLATE BINARY = ${parameter}`;
}

export class TicketAccessInterceptor implements NestInterceptor {
  constructor(private readonly access: TicketAccess) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http' || !this.access.enabled()) return next.handle();
    const request = context.switchToHttp().getRequest();
    return new Observable((subscriber) => {
      let subscription: { unsubscribe(): void } | undefined;
      this.access
        .requestActor(request)
        .then(async (actor) => {
          const route = Reflect.getMetadata(PATH_METADATA, context.getClass());
          if (
            !actor &&
            typeof route === 'string' &&
            /^escalated\/(agent|admin)(\/|$)/.test(route)
          ) {
            throw new ForbiddenException('Host authentication must identify the current user');
          }
          if (request.guestTicket && !(await this.access.allows(actor, request.guestTicket)))
            throw new NotFoundException();
          if (!subscriber.closed)
            this.access.withActor(actor, () => {
              subscription = next.handle().subscribe(subscriber);
            });
        })
        .catch((error) => subscriber.error(error));
      return () => subscription?.unsubscribe();
    });
  }
}
