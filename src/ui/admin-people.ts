import type { ApiToken } from '../entities/api-token.entity';
import type { Permission } from '../entities/permission.entity';
import type { Role } from '../entities/role.entity';
import { UiValidationException } from './inertia.interceptor';
import { iso, type UserDirectory } from './serializers';
import type { EscalatedUiHostUser, EscalatedUiRoleChange } from './ui-options';

/**
 * The people screens' shapes and form input (users, roles and API tokens), as
 * escalated-laravel's Admin\UserController, RoleController and
 * ApiTokenController send and validate them.
 */

/** A row of `Admin/Users/Index`, as Laravel's UserController maps a user. */
export function serializeHostUser(user: EscalatedUiHostUser) {
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
    is_admin: user.isAdmin === true,
    is_agent: user.isAgent === true,
  };
}

/** `PATCH users/:user/role`'s body, validated as Laravel's (`role` admin|agent, `value` boolean). */
export function userRoleInput(body: any): { role: 'admin' | 'agent'; value: boolean } {
  const errors: Record<string, string> = {};
  const role = body?.role;
  if (role !== 'admin' && role !== 'agent') errors.role = 'The selected role is invalid.';
  const raw = body?.value;
  const value =
    raw === true || raw === 1 || raw === '1' || raw === 'true'
      ? true
      : raw === false || raw === 0 || raw === '0' || raw === 'false'
        ? false
        : null;
  if (value === null) errors.value = 'The value field must be true or false.';
  if (Object.keys(errors).length) throw new UiValidationException(errors);
  return { role, value: value! };
}

/**
 * The access change for a toggle, with Laravel's rules: granting admin also
 * grants agent; revoking agent also revokes admin (an admin who is not an
 * agent would pass one gate and fail the other). Revoking admin leaves agent.
 */
export function roleChange(role: 'admin' | 'agent', value: boolean): EscalatedUiRoleChange {
  if (role === 'admin') return value ? { isAdmin: true, isAgent: true } : { isAdmin: false };
  return value ? { isAgent: true } : { isAgent: false, isAdmin: false };
}

/**
 * `PUT users/:user/roles`' body, validated as Laravel's (`role_ids` present
 * and an array of integers). Whether each role exists is checked against the
 * table afterwards.
 */
export function userRoleIdsInput(body: any): number[] {
  const raw = body?.role_ids;
  if (raw === undefined) {
    throw new UiValidationException({ role_ids: 'The role ids field must be present.' });
  }
  if (!Array.isArray(raw)) {
    throw new UiValidationException({ role_ids: 'The role ids field must be an array.' });
  }
  const ids: number[] = [];
  raw.forEach((value, index) => {
    const id =
      typeof value === 'number' ? value : /^-?\d+$/.test(String(value)) ? Number(value) : NaN;
    if (!Number.isInteger(id)) {
      throw new UiValidationException({
        [`role_ids.${index}`]: `The role_ids.${index} field must be an integer.`,
      });
    }
    if (!ids.includes(id)) ids.push(id);
  });
  return ids;
}

/**
 * The one role an agent profile holds, from the picker's set. The shared
 * screen sends the user's whole set with one role ticked or unticked, so the
 * set holds at most the current role plus the newly ticked one: that new one
 * wins. Null clears the role. Two new roles at once cannot be held.
 */
export function singleRoleFrom(ids: number[], current: number | null): number | null {
  if (!ids.length) return null;
  const added = ids.filter((id) => id !== current);
  if (added.length > 1) {
    throw new UiValidationException({
      role_ids: 'A user has one Escalated role here; choose one role.',
    });
  }
  return added[0] ?? current;
}

export function serializePermission(permission: Permission) {
  return {
    id: permission.id,
    name: permission.name,
    slug: permission.slug,
    group: permission.group ?? null,
    description: permission.description ?? null,
  };
}

/** Permissions keyed by group, as Laravel's `Permission::all()->groupBy('group')`. */
export function groupPermissions(permissions: Permission[]) {
  const grouped: Record<string, ReturnType<typeof serializePermission>[]> = {};
  for (const permission of permissions) {
    const group = permission.group || 'general';
    (grouped[group] ??= []).push(serializePermission(permission));
  }
  return grouped;
}

export function serializeRole(role: Role, usersCount = 0) {
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description ?? null,
    is_system: role.isSystem === true,
    users_count: usersCount,
    permissions: (role.permissions ?? []).map(serializePermission),
    created_at: iso(role.createdAt),
    updated_at: iso(role.updatedAt),
  };
}

export function roleInput(body: any): {
  name: string;
  description?: string;
  permissionIds?: number[];
} {
  const name = body?.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new UiValidationException({ name: 'The name field is required.' });
  }
  if (name.length > 100) {
    throw new UiValidationException({ name: 'The name may not be greater than 100 characters.' });
  }
  const raw = body?.permissions ?? [];
  if (!Array.isArray(raw)) {
    throw new UiValidationException({ permissions: 'The permissions must be a list.' });
  }
  const permissionIds = raw.map(Number);
  if (permissionIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new UiValidationException({ permissions: 'The selected permissions are invalid.' });
  }
  const description = typeof body?.description === 'string' ? body.description : undefined;
  return { name: name.trim(), description, permissionIds };
}

/** The abilities the shared token form offers. */
export const TOKEN_ABILITIES = ['agent', 'admin', '*'];

export function serializeApiToken(token: ApiToken, directory: UserDirectory) {
  const user = directory.get(String(token.userId));
  const expired = token.expiresAt != null && new Date(token.expiresAt) < new Date();
  return {
    id: token.id,
    name: token.name,
    user_id: token.userId,
    user_name: user?.name ?? `User #${token.userId}`,
    user_email: user?.email ?? null,
    abilities: token.abilities ?? [],
    last_used_at: iso(token.lastUsedAt),
    // Not recorded by this backend.
    last_used_ip: null,
    expires_at: iso(token.expiresAt),
    is_expired: expired,
    is_active: token.isActive !== false,
    created_at: iso(token.createdAt),
  };
}

export function apiTokenInput(body: any): {
  name: string;
  userId: string | number;
  abilities: string[];
  expiresAt?: Date;
} {
  const name = body?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 255) {
    throw new UiValidationException({ name: 'The name field is required.' });
  }
  const userId = body?.user_id;
  if (userId == null || userId === '' || typeof userId === 'object') {
    throw new UiValidationException({ user_id: 'The user field is required.' });
  }
  const abilities = body?.abilities;
  if (
    !Array.isArray(abilities) ||
    !abilities.length ||
    abilities.some((a) => !TOKEN_ABILITIES.includes(a))
  ) {
    throw new UiValidationException({ abilities: 'Choose agent, admin or all abilities.' });
  }
  const days = body?.expires_in_days;
  let expiresAt: Date | undefined;
  if (days != null && days !== '') {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      throw new UiValidationException({
        expires_in_days: 'The token must expire in 1 to 365 days.',
      });
    }
    expiresAt = new Date(Date.now() + n * 86_400_000);
  }
  return { name: name.trim(), userId, abilities: [...new Set<string>(abilities)], expiresAt };
}
