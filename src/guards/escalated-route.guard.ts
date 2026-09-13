import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { isObservable, lastValueFrom } from 'rxjs';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';

export type EscalatedRouteGroup = 'admin' | 'agent' | 'customer';

/** A host guard as accepted by `adminGuard` / `agentGuard` / `customerGuard`. */
export type EscalatedHostGuard = Type<CanActivate> | CanActivate;

const OPTION_FOR_GROUP = {
  admin: 'adminGuard',
  agent: 'agentGuard',
  customer: 'customerGuard',
} as const satisfies Record<EscalatedRouteGroup, keyof EscalatedModuleOptions>;

/**
 * Applies the host-configured guard for a route group.
 *
 * Escalated owns no users or sessions, so it cannot decide on its own who is an
 * admin, an agent or a customer. The host supplies that decision as a guard in
 * `EscalatedModule.forRoot()`. When the matching guard is not configured, the
 * group refuses every request: an unconfigured install must not expose admin
 * or agent routes to anonymous callers.
 *
 * A guard may be given as a class or as an instance. A class that the host has
 * registered as a provider is used as that instance; otherwise it is created
 * with dependency injection in Escalated's module context.
 */
abstract class EscalatedRouteGroupGuard implements CanActivate {
  private static readonly warned = new Set<string>();
  private readonly logger = new Logger('EscalatedRouteGuard');
  private readonly instances = new Map<Type<CanActivate>, Promise<CanActivate>>();

  protected constructor(
    private readonly groups: EscalatedRouteGroup[],
    private readonly moduleRef: ModuleRef,
    private readonly options?: EscalatedModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const hostGuards = this.groups
      .map((group) => this.options?.[OPTION_FOR_GROUP[group]] as EscalatedHostGuard | undefined)
      .filter((guard): guard is EscalatedHostGuard => Boolean(guard));

    if (hostGuards.length === 0) {
      this.warnOnce(
        `Escalated ${this.groups.join('/')} routes refuse every request because ${this.groups
          .map((group) => `\`${OPTION_FOR_GROUP[group]}\``)
          .join(' or ')} is not configured in EscalatedModule.forRoot().`,
      );
      throw new ForbiddenException();
    }

    // With several groups (attachments are shared by agents and customers) any
    // one guard admitting the request is enough. The last refusal wins otherwise.
    let refusal: unknown;
    for (const hostGuard of hostGuards) {
      try {
        if (await this.runHostGuard(hostGuard, context)) {
          return true;
        }
      } catch (error) {
        refusal = error;
      }
    }

    if (refusal) {
      throw refusal;
    }
    return false;
  }

  private async runHostGuard(
    hostGuard: EscalatedHostGuard,
    context: ExecutionContext,
  ): Promise<boolean> {
    const guard = await this.resolve(hostGuard);
    if (typeof guard?.canActivate !== 'function') {
      this.warnOnce(
        `Escalated ${this.groups.join('/')} guard is not a CanActivate class or instance; refusing.`,
      );
      throw new ForbiddenException();
    }

    const result = guard.canActivate(context);
    return Boolean(isObservable(result) ? await lastValueFrom(result) : await result);
  }

  private resolve(hostGuard: EscalatedHostGuard): Promise<CanActivate> {
    if (typeof hostGuard !== 'function') {
      return Promise.resolve(hostGuard);
    }

    let instance = this.instances.get(hostGuard);
    if (!instance) {
      instance = this.instantiate(hostGuard);
      this.instances.set(hostGuard, instance);
      instance.catch(() => this.instances.delete(hostGuard));
    }
    return instance;
  }

  private async instantiate(type: Type<CanActivate>): Promise<CanActivate> {
    try {
      return this.moduleRef.get(type, { strict: false });
    } catch {
      return this.moduleRef.create(type);
    }
  }

  private warnOnce(message: string): void {
    if (EscalatedRouteGroupGuard.warned.has(message)) return;
    EscalatedRouteGroupGuard.warned.add(message);
    this.logger.warn(message);
  }
}

/** Guards `/escalated/admin/*` with the host's `adminGuard`. */
@Injectable()
export class EscalatedAdminGuard extends EscalatedRouteGroupGuard {
  constructor(
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) options?: EscalatedModuleOptions,
  ) {
    super(['admin'], moduleRef, options);
  }
}

/** Guards `/escalated/agent/*` with the host's `agentGuard`. */
@Injectable()
export class EscalatedAgentGuard extends EscalatedRouteGroupGuard {
  constructor(
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) options?: EscalatedModuleOptions,
  ) {
    super(['agent'], moduleRef, options);
  }
}

/** Guards `/escalated/customer/tickets/*` with the host's `customerGuard`. */
@Injectable()
export class EscalatedCustomerGuard extends EscalatedRouteGroupGuard {
  constructor(
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) options?: EscalatedModuleOptions,
  ) {
    super(['customer'], moduleRef, options);
  }
}

/**
 * Guards routes shared by the agent and customer ticket views (attachment
 * downloads): admitted when either `agentGuard` or `customerGuard` admits.
 */
@Injectable()
export class EscalatedAgentOrCustomerGuard extends EscalatedRouteGroupGuard {
  constructor(
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) options?: EscalatedModuleOptions,
  ) {
    super(['agent', 'customer'], moduleRef, options);
  }
}
