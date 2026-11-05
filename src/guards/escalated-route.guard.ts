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
import { accessFeatureEnabled } from '../access/access-features';
import { AccessControlService } from '../access/access-control.service';
import { TwoFactorGate } from '../access/two-factor-gate';
import { markEmbedded, resolveEmbed } from '../ui/embed';

export type EscalatedRouteGroup = 'admin' | 'agent' | 'customer';

/** Request property naming the route group whose host guard admitted the request. */
export const ESCALATED_ROUTE_GROUP = 'escalatedRouteGroup';

/**
 * Request property naming the route group whose host guard is being asked
 * right now, so a host guard (the API token guard) can tell an admin route
 * from an agent one.
 */
export const ESCALATED_REQUESTED_GROUP = 'escalatedRequestedGroup';

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
    protected readonly options?: EscalatedModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const hostGuards = this.groups
      .map((group) => ({
        group,
        guard: this.options?.[OPTION_FOR_GROUP[group]] as EscalatedHostGuard | undefined,
      }))
      .filter((entry): entry is { group: EscalatedRouteGroup; guard: EscalatedHostGuard } =>
        Boolean(entry.guard),
      );

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
    const request = context.getType() === 'http' ? context.switchToHttp().getRequest() : null;
    for (const { group, guard } of hostGuards) {
      try {
        if (request) request[ESCALATED_REQUESTED_GROUP] = group;
        if (await this.runHostGuard(guard, context)) {
          // Shared routes (attachments) authorise differently per group.
          if (context.getType() === 'http') {
            context.switchToHttp().getRequest()[ESCALATED_ROUTE_GROUP] = group;
            // Roles & permissions: the host guard decides who reaches the
            // area; the user's role must also grant the route's permission.
            // Two-factor: an enrolled user must have passed the challenge.
            if (group !== 'customer') await this.enforceStaffChecks(context);
          }
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

  /** Two-factor and roles & permissions, which every staff area keeps. */
  protected async enforceStaffChecks(context: ExecutionContext): Promise<void> {
    await this.enforceTwoFactor(context);
    await this.enforcePermissions(context);
  }

  private async enforceTwoFactor(context: ExecutionContext): Promise<void> {
    if (!accessFeatureEnabled(this.options, 'two_factor')) return;
    let gate: TwoFactorGate;
    try {
      gate = this.moduleRef.get(TwoFactorGate, { strict: false });
    } catch {
      throw new ForbiddenException();
    }
    await gate.check(context);
  }

  private async enforcePermissions(context: ExecutionContext): Promise<void> {
    if (!accessFeatureEnabled(this.options, 'roles_permissions')) return;
    let access: AccessControlService;
    try {
      access = this.moduleRef.get(AccessControlService, { strict: false });
    } catch {
      throw new ForbiddenException();
    }
    await access.enforceRoute(context);
  }

  protected async runHostGuard(
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

/**
 * Guards a staff member's own screens (two-factor enrolment and challenge):
 * admitted when either `adminGuard` or `agentGuard` admits.
 */
@Injectable()
export class EscalatedStaffGuard extends EscalatedRouteGroupGuard {
  constructor(
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) options?: EscalatedModuleOptions,
  ) {
    super(['admin', 'agent'], moduleRef, options);
  }
}

/**
 * Guards the admin routes while they are embedded in the host's admin panel
 * (`ui.embed`, ADR 2026-11-05-embeddable-admin), in place of
 * `EscalatedAdminGuard`. The host's `ui.embed.guards` run first; then
 * Escalated's admin gate (`adminGuard`, two-factor, route permissions), or,
 * with `replaceAdminGate`, two-factor and route permissions only. An admitted
 * request is marked as embedded (and, in iframe mode, gets the framing
 * headers).
 */
@Injectable()
export class EmbeddedAdminGuard extends EscalatedRouteGroupGuard {
  constructor(
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) options?: EscalatedModuleOptions,
  ) {
    super(['admin'], moduleRef, options);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const embed = resolveEmbed(this.options);
    // Mounted only while embedding is on; refuse rather than guess otherwise.
    if (!embed || context.getType() !== 'http') throw new ForbiddenException();
    const request = context.switchToHttp().getRequest();

    for (const guard of embed.guards) {
      request[ESCALATED_REQUESTED_GROUP] = 'admin';
      if (!(await this.runHostGuard(guard, context))) return false;
    }

    if (embed.replaceAdminGate) {
      await this.enforceStaffChecks(context);
    } else if (!(await super.canActivate(context))) {
      return false;
    }

    markEmbedded(request, context.switchToHttp().getResponse(), embed);
    return true;
  }
}
