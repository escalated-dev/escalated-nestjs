import type { EscalatedModuleOptions } from './escalated.config';

/**
 * Install-level switches for the optional public route groups. Each is read
 * from `EscalatedModule.forRoot()`, else its env var, else on (the routes are
 * registered, as before these switches existed). Off: the group's routes are
 * not registered at all.
 */

function parse(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (text === '') return null;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return null;
}

function enabled(configured: unknown, env: string): boolean {
  return parse(configured) ?? parse(process.env[env]) ?? true;
}

/**
 * The embeddable widget's routes (`/escalated/widget/*`, widget chat and
 * `embed.js`): `widget.enabled`, else `ESCALATED_WIDGET_ENABLED`, else on.
 */
export function widgetRoutesEnabled(options: EscalatedModuleOptions | null | undefined): boolean {
  return enabled(options?.widget?.enabled, 'ESCALATED_WIDGET_ENABLED');
}

/**
 * The guest portal's routes (`/escalated/guest/*`, JSON and screens):
 * `guest.routesEnabled`, else `ESCALATED_GUEST_ROUTES`, else on.
 */
export function guestRoutesEnabled(options: EscalatedModuleOptions | null | undefined): boolean {
  return enabled(options?.guest?.routesEnabled, 'ESCALATED_GUEST_ROUTES');
}
