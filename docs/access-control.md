# Access control: roles & permissions, two-factor, SSO

Escalated's roles & permissions, two-factor authentication and single sign-on
are **install-level switches**, off by default
([ADR 2026-10-29](https://github.com/escalated-dev/escalated-developer-context/blob/main/decisions/2026-10-29-configurable-access-features.md)).
While a switch is off its screens and routes answer 404 and nothing is
enforced; the host's `adminGuard` / `agentGuard` decide who may do what,
exactly as before. While it is on, the feature is enforced.

The switches are read from the module options, else the environment. No admin
screen or stored setting changes them.

| Feature | Option | Env var |
|---|---|---|
| Roles & permissions | `access.rolesPermissions` | `ESCALATED_ROLES_PERMISSIONS` |

```ts
EscalatedModule.forRoot({
  adminGuard: MyAdminGuard,
  agentGuard: MyAgentGuard,
  access: { rolesPermissions: true },
});
```

## Roles & permissions

### What is enforced

With the switch on, every admin and agent route needs a permission **in
addition to** the host guard for that area. A user's permissions are those of
their Escalated role (the role on their agent profile). Nothing else grants
one: passing `adminGuard` gives no permissions by itself, and a role's slug
means nothing, only the permissions it holds. Give users who should have
everything the `admin` role.

- The route to permission map is `src/access/route-permissions.ts`
  (escalated-laravel's `RoutePermissions`, keyed by method and path). A route
  missing from it is refused, and a test checks every admin and agent route is
  in it. Reads need `*.view`, writes `*.manage` (or the finer
  `create`/`edit`/`delete` slugs where they exist).
- A status change needs `ticket.edit`, plus `ticket.close` when the new status
  is `resolved`, `closed`, `reopened` or any solved status.
- Bulk actions need the permission of the action: `assign` needs
  `ticket.assign`, `delete` needs `ticket.delete`, the rest `ticket.edit`.
- Changing the assignee through `PUT /escalated/agent/tickets/:id` needs
  `ticket.assign`; an internal reply needs `reply.create_internal`.
- Applying a macro needs `macro.view` and `ticket.edit`.
- API tokens act as their owner, so a token request is checked against the
  owner's permissions as well as the token's abilities.
- The newsletter screens check `newsletters.manage` and `newsletters.send`, and
  plugin pages and endpoints check the capability they declare, only while the
  switch is on. `PermissionsGuard` / `@RequirePermissions()` on host routes
  follow the switch too.
- Your own two-factor routes need no permission.

Failing a permission answers 403.

### Seeded roles

The `RolesAndPermissions1793404800000` migration (or
`RoleService.seedPermissions()`) creates escalated-laravel's permissions and
three system roles:

| Role | Permissions |
|---|---|
| `admin` | all |
| `agent` | `ticket.*`, `reply.*`, `kb.view`, `report.view`, `macro.view`, `macro.create`, `tag.view`, `custom_field.view`, `audit.view` |
| `light_agent` | `ticket.view`, `reply.create`, `reply.create_internal`, `kb.view`, `macro.view`, `tag.view` |

Custom roles are made in **Admin > Roles**, which exists while the switch is on.

### Giving users roles

`moduleRef.get(RoleService).assignRole(userId, 'admin')` sets the role on the
user's agent profile, creating one if needed. Use it to give yourself the
`admin` role before switching roles on.

### Turning it on

1. Run the `RolesAndPermissions1793404800000` migration.
2. Give every staff user a role, starting with yourself.
3. Set `access: { rolesPermissions: true }` or `ESCALATED_ROLES_PERMISSIONS=true`.

### Shared props

Every page gets `escalated.features.roles_permissions` (boolean) and
`escalated.permissions`: the user's slugs while on, `['*']` for staff while
off, `[]` for everyone else.
