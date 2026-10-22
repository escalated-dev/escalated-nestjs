import type { EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import type { SettingsService } from './settings.service';

export type GuestPolicy = EscalatedModuleOptions['guestPolicy'];

/**
 * The effective guest policy: the `guest_policy` setting overrides the module
 * option, so admins can change it at runtime without a redeploy.
 */
export async function resolveGuestPolicy(
  settings: SettingsService,
  options: EscalatedModuleOptions,
): Promise<GuestPolicy> {
  const stored = await settings.getTyped<GuestPolicy | null>('guest_policy', null);
  return stored ?? options.guestPolicy;
}

/** The requester a guest's ticket is filed under, by guest policy. */
export function requesterIdForPolicy(policy: GuestPolicy): UserId {
  if (!policy) return 0;
  switch (policy.mode) {
    case 'guest_user':
      return policy.guestUserId;
    case 'unassigned':
    case 'prompt_signup':
    default:
      return 0;
  }
}
