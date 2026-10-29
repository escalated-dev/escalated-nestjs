import type { EscalatedModuleOptions } from '../config/escalated.config';

/**
 * The install-level access switches (ADR 2026-10-29-configurable-access-features):
 * `access.*` in `EscalatedModule.forRoot()`, else the `ESCALATED_*` env var,
 * else off. Never read from the settings table: each one changes who may sign
 * in or what they may do, so no stored setting may flip it.
 */
export type AccessFeature = 'roles_permissions' | 'two_factor' | 'sso';

const OPTION: Record<AccessFeature, string> = {
  roles_permissions: 'rolesPermissions',
  two_factor: 'twoFactor',
  sso: 'sso',
};

const ENV: Record<AccessFeature, string> = {
  roles_permissions: 'ESCALATED_ROLES_PERMISSIONS',
  two_factor: 'ESCALATED_TWO_FACTOR',
  sso: 'ESCALATED_SSO',
};

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

export function accessFeatureEnabled(
  options: EscalatedModuleOptions | null | undefined,
  feature: AccessFeature,
): boolean {
  const configured = (options?.access as Record<string, unknown> | undefined)?.[OPTION[feature]];
  if (configured !== undefined && configured !== null) return truthy(configured);
  return truthy(process.env[ENV[feature]]);
}

/** The `escalated.features` entries the shared frontend reads. */
export function sharedAccessFeatures(
  options: EscalatedModuleOptions | null | undefined,
): Record<AccessFeature, boolean> {
  return {
    roles_permissions: accessFeatureEnabled(options, 'roles_permissions'),
    two_factor: accessFeatureEnabled(options, 'two_factor'),
    sso: accessFeatureEnabled(options, 'sso'),
  };
}
