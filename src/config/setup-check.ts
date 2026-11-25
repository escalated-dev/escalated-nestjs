import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from './escalated.config';

/** One thing the host has not set up, and what it breaks. */
export interface SetupProblem {
  check: string;
  message: string;
}

const GUARDS = [
  ['adminGuard', '/escalated/admin/*'],
  ['agentGuard', '/escalated/agent/*'],
  ['customerGuard', '/escalated/customer/tickets/*'],
] as const;

/**
 * What the host still has to set up, read from the module options: the route
 * group guards (Escalated's gates: without one the group refuses every
 * request) and the user contract. The user contract itself (`req.user.id`)
 * can only be checked per request; `requireUserId` names it when it fails.
 */
export function setupProblems(options: EscalatedModuleOptions | null | undefined): SetupProblem[] {
  const problems: SetupProblem[] = [];
  for (const [option, routes] of GUARDS) {
    const guard = options?.[option];
    if (!guard) {
      problems.push({
        check: option,
        message:
          `${option} is not configured, so every ${routes} route answers 403. Pass a ` +
          'CanActivate guard that authenticates the request and sets req.user = { id } ' +
          '(see docs/getting-started.md, "Route guards").',
      });
    } else if (typeof guard !== 'function' && typeof guard?.canActivate !== 'function') {
      problems.push({
        check: option,
        message: `${option} is not a CanActivate class or instance, so every ${routes} route answers 403.`,
      });
    }
  }
  for (const [index, guard] of (options?.customerRouteGuards ?? []).entries()) {
    if (typeof guard !== 'function' && typeof guard?.canActivate !== 'function') {
      problems.push({
        check: 'customerRouteGuards',
        message: `customerRouteGuards[${index}] is not a CanActivate class or instance, so every customer route answers 403.`,
      });
    }
  }
  return problems;
}

/** Logs the setup problems once at startup, so they show before the first click. */
@Injectable()
export class EscalatedSetupCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger('EscalatedSetup');

  constructor(
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  problems(): SetupProblem[] {
    return setupProblems(this.options);
  }

  onApplicationBootstrap(): void {
    for (const problem of this.problems()) this.logger.warn(problem.message);
  }
}
