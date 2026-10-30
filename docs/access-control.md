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
| Two-factor authentication | `access.twoFactor` | `ESCALATED_TWO_FACTOR` |
| Single sign-on | `access.sso` | `ESCALATED_SSO` |

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

While the switch is on, **Admin > Users** also shows a roles column, and an
admin with `role.manage` can change a user's role there
(`PUT /escalated/admin/users/:user/roles`, route name
`escalated.admin.users.roles`, body `{ "role_ids": [...] }`, as
escalated-laravel). The ids must be existing roles (422 otherwise).

A user holds **one** Escalated role in this package (the role on their agent
profile), where Laravel keeps a set. The screen sends the user's whole set with
one role ticked or unticked, so:

- `[]` clears the role;
- one id sets that role (creating the agent profile if needed);
- the current role plus one other sets the other one (ticking a new role
  replaces the old one);
- two roles that are both new are refused with a 422 on `role_ids`.

You cannot leave yourself without `role.manage`: that change is refused with
the error "You cannot remove your own role management." When the host provides
`ui.resolveUsers`, a user it does not return is a 404.

### Turning it on

1. Run the `RolesAndPermissions1793404800000` migration.
2. Give every staff user a role, starting with yourself.
3. Set `access: { rolesPermissions: true }` or `ESCALATED_ROLES_PERMISSIONS=true`.

### Shared props

Every page gets `escalated.features.roles_permissions` (boolean) and
`escalated.permissions`: the user's slugs while on, `['*']` for staff while
off, `[]` for everyone else.

## Two-factor authentication

### Before turning it on

- **A session.** The challenge is remembered in a session:
  - the host's, when it gives requests a `req.session` object
    (express-session, cookie-session, passport's, ...);
  - otherwise Escalated's own, mounted on its `/escalated/*` routes only, when
    the `express-session` package is installed (an optional peer dependency),
    the `session` option is not `false`, and a key is configured:
    `session.secret`, else `ESCALATED_SESSION_SECRET`, else one derived from
    the two-factor sealing key below. Its cookie is `escalated.sid`
    (HttpOnly, SameSite=Lax, written only once something is stored). Without
    `session.store` it uses express-session's MemoryStore, which holds one
    process's sessions and loses them on restart: pass a store
    (`session: { store: new RedisStore(...) }`) for more than one instance.
    Express adapter only.

  With neither (no `req.session`, and express-session not installed, or
  `session: false`, or no key), an enrolled user is refused (403, "needs a
  session") rather than let through.
- **A new session on every login.** passport (0.6+) and most login handlers
  regenerate the session when someone signs in, so every login is challenged.
  If yours does not, call `forgetTwoFactorSession(req)` (exported) when a user
  signs in or out.
- **A sealing key.** TOTP secrets and recovery codes are sealed at rest with
  AES-256-GCM. Set `twoFactor.secret` or `ESCALATED_TWO_FACTOR_SECRET` (it
  falls back to `guestAccess.secret`, `ESCALATED_GUEST_ACCESS_SECRET`, then
  `inbound.replySecret`) and keep it stable.
- **The migration.** Run `TwoFactor1793491200000` (`escalated_two_factor`).

Then set `access: { twoFactor: true }` or `ESCALATED_TWO_FACTOR=true`.

### What is enforced

- TOTP is RFC 6238 (SHA-1, 6 digits, 30 s) through the `otpauth` library, with
  one step of drift either side. A code's time step is recorded when it is
  accepted, and that step or an earlier one is refused afterwards.
- A staff user with a confirmed enrolment who opens any admin or agent route
  without having passed the challenge in this session is sent to
  `GET /escalated/two-factor/challenge` (`Escalated/Auth/TwoFactorChallenge`,
  props `action` and `error`). API clients get
  `403 {"two_factor_required": true}` instead of a redirect.
- The challenge posts `code` or `recovery_code` to
  `POST /escalated/two-factor/challenge`. Success regenerates the session id
  (keeping its data), marks the session for that user and returns to the page
  they asked for. Failure is a validation error on the field sent. Five
  attempts per user per minute; then 429.
- Eight single-use recovery codes are issued at setup. A code that signs
  someone in is removed.
- Enrolment, `GET /escalated/admin/settings/two-factor`
  (`Escalated/Admin/Settings/TwoFactor`) with `setup`, `confirm` and `disable`
  posts, is open to every staff user (admin or agent guard), not only admins,
  and needs no permission. Confirming marks the session as passed.
- API token requests are not session-based and are not challenged.
- Enrolments that earlier versions kept on the agent profile are moved to
  `escalated_two_factor`, sealed, the first time they are used.

### Requiring it

`twoFactor.required` (`ESCALATED_TWO_FACTOR_REQUIRED`), or the
`two_factor_required` setting in Admin > Settings (which wins once saved, and is
offered only while two-factor is on). When required, a staff user without an
enrolment is sent to enrol and can use nothing else until they do. Pages get
`escalated.two_factor_required` for the signed-in staff user.

### Lost device

`moduleRef.get(TwoFactorService).reset(userId)` removes a user's enrolment.

### While it is off

The enrolment and challenge routes answer 404 and nobody is challenged.
Enrolments are kept.

## Single sign-on

### Before turning it on

On a NestJS + TypeORM host SSO needs no hooks: it finds users in the module's
`userEntity` and signs them in with passport or the session.

```ts
EscalatedModule.forRoot({
  access: { sso: true },
  appUrl: 'https://help.example.com', // the base of the SSO endpoints
  userEntity: User, // or its table name, e.g. 'users'
});
```

| Step | Host hook (always wins) | Default | Without it |
|---|---|---|---|
| Find by email | `sso.findUserByEmail(email)` | the `userEntity` row whose `sso.userEmailColumn` (default `email`) matches, case-insensitively, on the host's default DataSource (else Escalated's, if only that one has the entity). Its primary key must be `id`. | refused (no `userEntity`) |
| Create (only with `sso.createUsers`) | `sso.createUser({ email, name })` | none: Escalated cannot know which columns your user table requires | unknown emails are refused |
| Sign in | `sso.signIn(req, user)` | passport's `req.login(user)` when the request has it (your `serializeUser` gets the `userEntity` row); else the user (`id`, `email`, `name`) is kept in the session (the host's, or Escalated's own; see two-factor's "A session") and becomes `req.user` on Escalated's routes when nothing else set one. Read it on your own routes with `ssoSessionUser(req)`; sign out with `forgetSsoSessionUser(req)` or by destroying the session. | refused: no hook, no `req.login` and no session |

Your admin and agent guards still decide who gets in. With the session
default they see the signed-in user as `req.user`.

To use your own user service, login or user creation, set the hooks:

```ts
sso: {
  findUserByEmail: (email) => users.findByEmailIgnoringCase(email),
  signIn: (req, user) => new Promise((ok, fail) => req.login(user, (e) => (e ? fail(e) : ok()))),
  createUser: ({ email, name }) => users.create({ email, name }), // only with createUsers
},
```

OAuth 2 / OIDC keeps its `state` and PKCE verifier in the same session, so it
also needs one of the two sessions.

Then run the `SsoMessageIds1793577600000` migration (`escalated_sso_message_ids`),
choose the provider in **Admin > Settings > SSO**
(`/escalated/admin/settings/sso`), and give the identity provider the
endpoints that page lists.

| Option | Env var | Default |
|---|---|---|
| `sso.spEntityId` | `ESCALATED_SSO_SP_ENTITY_ID` | the SP metadata URL |
| `sso.allowIdpInitiated` | `ESCALATED_SSO_ALLOW_IDP_INITIATED` | false |
| `sso.jwtAudience` | `ESCALATED_SSO_JWT_AUDIENCE` | `appUrl` |
| `sso.clockSkew` | `ESCALATED_SSO_CLOCK_SKEW` | 120 (max 300) |
| `sso.createUsers` | `ESCALATED_SSO_CREATE_USERS` | false |
| `sso.syncRoles` | `ESCALATED_SSO_SYNC_ROLES` | false |
| `sso.redirectTo` | `ESCALATED_SSO_REDIRECT_TO` | `/escalated/agent` |

### Routes

| Route | Use |
|---|---|
| `GET /escalated/sso/login` | Start sign-in with the configured provider (404 while it is `none`) |
| `GET /escalated/sso/saml/metadata` | SP metadata; its URL is the default SP entity ID |
| `POST /escalated/sso/saml/acs` | SAML assertion consumer (HTTP-POST binding) |
| `GET /escalated/sso/oauth/callback` | OAuth 2 / OIDC redirect URI |
| `GET\|POST /escalated/sso/jwt/callback` | JWT hand-off (`jwt` parameter) |

Every route answers 404 while `access.sso` is off or serves a provider other
than the chosen one. Every refusal answers a generic 403 and logs the reason.

### What is checked

- **SAML** (signatures through `xml-crypto`, as escalated-adonis): the IdP
  certificate must be configured; the single assertion must carry a signature
  by it (a signed Response alone is not enough, keys in `KeyInfo` are never
  trusted, and the user is read from the signed XML); `EncryptedAssertion` is
  refused; `Issuer` equals the IdP entity ID; `Audience` names the SP entity
  ID; the Response `Destination` and the bearer `Recipient` equal the ACS URL;
  validity windows hold within the clock skew; `InResponseTo` names an
  AuthnRequest issued in the last 10 minutes, consumed on use (stored in the
  database, not the session), unless IdP-initiated sign-in is allowed; and the
  assertion ID is used once.
- **OAuth 2 / OIDC** (`simple-oauth2`): authorization code with a single-use
  `state` kept in the session and PKCE (`S256`); the code is exchanged server
  to server and the profile read from the userinfo URL. A missing or
  mismatched `state`, an IdP `error`, or `email_verified: false` is refused.
- **JWT** (`jsonwebtoken`): `alg` must be the configured algorithm (HS* with
  the secret, RS* with the public key), so `none` and algorithm switching are
  refused; `exp` is required; `nbf` holds within the skew; `aud` must name
  this install; `jti` is required and used once.

### Users and roles

The email comes from the configured attribute or claim (SAML falls back to an
email-shaped NameID) and is matched with `sso.findUserByEmail`, else in
`userEntity`. An unknown email is refused unless `sso.createUsers` is on and
`sso.createUser` is given.
With roles & permissions on and `sso.syncRoles`, an asserted role naming an
existing Escalated role slug becomes the user's role; an unknown one changes
nothing. SSO never grants the host's admin or agent guard.

On success the user is signed in (above), the session id is regenerated, the two-factor
mark is cleared (signing in through SSO does not skip the challenge), and the
user goes to the page they asked for, else `sso.redirectTo`. Escalated does
not turn off the host's own password login.
