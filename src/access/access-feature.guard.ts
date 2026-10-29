import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { accessFeatureEnabled, type AccessFeature } from './access-features';

export const ACCESS_FEATURE_KEY = 'escalated:accessFeature';

/**
 * Answers 404 while the install-level access switch is off, as Laravel's
 * `EnsureFeatureEnabled`: the feature's screens and routes are simply not
 * there.
 */
@Injectable()
export class AccessFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<AccessFeature | undefined>(
      ACCESS_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (feature && !accessFeatureEnabled(this.options, feature)) {
      throw new NotFoundException();
    }
    return true;
  }
}

/** Hides a route (404) while the named access switch is off. */
export const RequiresAccessFeature = (feature: AccessFeature) =>
  applyDecorators(SetMetadata(ACCESS_FEATURE_KEY, feature), UseGuards(AccessFeatureGuard));
