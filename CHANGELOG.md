# Changelog

All notable changes to `@escalated-dev/escalated-nestjs` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.9] - 2026-10-30

### Upgrading
- **Single sign-on is a new install-level switch, off by default** (`access.sso`,
  env `ESCALATED_SSO`; ADR 2026-10-29-configurable-access-features). While it
  is off every `/escalated/sso/*` route and Admin > Settings > SSO answer 404,
  so nothing changes for existing installs. To turn it on: run the new
  `SsoMessageIds1793577600000` migration, provide the `sso.findUserByEmail`
  and `sso.signIn` hooks (and `sso.createUser` with `sso.createUsers`), set
  `appUrl`, give the IdP the endpoints from the SSO page, make sure a SAML
  install has the IdP certificate, then set `ESCALATED_SSO=true`. See
  `docs/access-control.md`.
- **Two-factor authentication is now an install-level switch, off by default**
  (`access.twoFactor`, env `ESCALATED_TWO_FACTOR`; ADR
  2026-10-29-configurable-access-features). Nothing ever asked for the code, so
  off is how every install already behaved. While it is off the enrolment and
  challenge routes answer 404.
  - The JSON routes `/escalated/admin/2fa/{generate,enable,verify,disable}` are
    replaced by `/escalated/admin/settings/two-factor` (`GET`, and `POST`
    `setup`, `confirm`, `disable`), open to agents as well as admins, which
    answer JSON to API clients and the shared `Admin/Settings/TwoFactor` screen
    to browsers.
  - `TwoFactorService` is rewritten: `generateSecret(userId)`, `enable`,
    `verify` are gone (use `setup`, `confirm`, `confirmedFor`,
    `verifyAndConsume`, `useRecoveryCode`, `disable`, `reset`).
  - `otplib` and `qrcode` are no longer dependencies. TOTP now uses `otpauth`,
    which also loads on Node 20 (otplib 13's ESM-only dependency did not).
  To turn it on: run the new `TwoFactor1793491200000` migration, make sure the
  host gives requests a session (`req.session`, e.g. express-session) that is
  regenerated on login, set a stable `twoFactor.secret` /
  `ESCALATED_TWO_FACTOR_SECRET`, then set `ESCALATED_TWO_FACTOR=true`. Users
  who enrolled on their agent profile are challenged from their next visit.
  Set `ESCALATED_TWO_FACTOR_REQUIRED=true` (or the setting) only after telling
  staff. See `docs/access-control.md`.
- **Roles & permissions is now an install-level switch, off by default**
  (`access.rolesPermissions` in `EscalatedModule.forRoot()`, env
  `ESCALATED_ROLES_PERMISSIONS`; ADR 2026-10-29-configurable-access-features).
  Roles were stored but only the newsletter screens and plugin capabilities
  ever checked them, so off is how almost every install already behaved. The
  visible differences while it is off:
  - The roles screens and API (`/escalated/admin/roles*`,
    `/escalated/admin/permissions`) answer 404.
  - The newsletter screens no longer check `newsletters.manage` /
    `newsletters.send`, and plugin capabilities, `PermissionsGuard` and
    `@RequirePermissions()` no longer check roles: the host's `adminGuard` /
    `agentGuard` decide. The newsletter admin screens (`/admin/newsletters*`)
    are now behind `adminGuard` (they had no group guard). Installs that used
    roles to restrict admins must turn the switch on.
  - The role named `admin` no longer passes every check by its slug: a role
    grants exactly the permissions it holds.
  To enforce roles: run the new `RolesAndPermissions1793404800000` migration
  (it seeds escalated-laravel's permission slugs and the `admin`, `agent` and
  `light_agent` roles), give every staff user a role
  (`RoleService.assignRole(userId, 'admin')` for yourself first), then set
  `access: { rolesPermissions: true }` or `ESCALATED_ROLES_PERMISSIONS=true`.
  An admin without a role is refused everywhere but their own two-factor
  routes. See `docs/access-control.md`.
- The shared `escalated.permissions` prop is `['*']` for staff while the
  switch is off (it was always `[]`), and `escalated.features` carries
  `roles_permissions`, `two_factor` and `sso`.
- Run the new `Plugins1793318400000` migration (exported from the package). It
  creates `escalated_plugins` and `escalated_plugin_store`. Nothing else changes
  for a host that registers no plugins.
- New routes under `/escalated`: `admin/plugins` (the screens, with
  `ui.enabled`), `api/plugins/*` (behind `adminGuard`) and `webhooks/plugins/*`
  (public). With no plugins registered they answer 404, apart from the empty
  Admin > Plugins list.

### Added
- **Admin > Users roles picker.** While roles & permissions is on, the users
  screen sends `roles` (`{id, name, slug}`, by name) and each user's role slugs,
  and `PUT /escalated/admin/users/:user/roles` (`escalated.admin.users.roles`,
  `{role_ids: [...]}`, needs `role.manage`) changes a user's role, as
  escalated-laravel. A user has one role here, so the set maps to one role;
  see docs/access-control.md. While the switch is off the route answers 404 and
  `roles` is null.
- **Single sign-on through SAML, OAuth 2 / OIDC or JWT** when switched on, with
  the provider chosen in Admin > Settings > SSO (`Admin/Settings/SsoSettings`,
  secrets masked, endpoints listed). SAML checks the assertion signature
  against the configured certificate, Issuer, Audience,
  Destination/Recipient, validity windows, InResponseTo against requests
  issued in the last 10 minutes, and replay; OAuth uses a session-bound state
  and PKCE; JWT pins the algorithm and requires `exp`, `aud` and a single-use
  `jti`. Users are matched by email through host hooks, created only with
  `sso.createUsers`, and given the asserted role only with roles on and
  `sso.syncRoles`. New dependencies: `xml-crypto`, `@xmldom/xmldom`,
  `simple-oauth2`, `jsonwebtoken`.
- **Two-factor authentication is enforced when switched on.** A staff user
  with a confirmed TOTP enrolment must pass `Auth/TwoFactorChallenge` (TOTP
  code or single-use recovery code; replayed codes refused; 5 attempts per
  minute) in their session before any admin or agent route; API clients get
  `403 {two_factor_required: true}`. Secrets and recovery codes are sealed
  (AES-256-GCM) in `escalated_two_factor`. Admins can require enrolment
  (`twoFactor.required` or the `two_factor_required` setting), and
  `TwoFactorService.reset(userId)` clears a lost device. Pages get
  `escalated.two_factor_required`.
- **Roles & permissions are enforced when switched on.** Every admin and agent
  route (JSON and screens, and API token requests, which act as the token's
  owner) needs its permission from the user's Escalated role as well as the
  host guard; the map is `src/access/route-permissions.ts`, a route missing
  from it is refused, and a test checks every route is mapped. Status changes
  to `resolved`/`closed`/`reopened` (or any solved status) also need
  `ticket.close`, bulk actions need each action's permission, an assignee
  change needs `ticket.assign` and an internal reply `reply.create_internal`.
  Failing answers 403.
- `RoleService.assignRole(userId, roleSlug)` gives a user a role, and
  `RoleService.seedPermissions()` seeds the same permissions and roles as the
  migration.
- `ctx.broadcast` reaches the Socket.IO gateway (it was a no-op): `toUser`
  goes to that user's sockets, `toTicket` to sockets in the ticket's room that
  may see it, and `toChannel` to sockets that joined the plugin channel with the
  new `join:plugin` message, as escalated-laravel's `plugin.{channel}`,
  `private-user.{id}` and `private-ticket.{id}` channels. Without
  `enableWebsockets` it still does nothing.
- **Plugins**, per the shared
  [plugin contract](https://github.com/escalated-dev/escalated-developer-context/blob/main/domain-model/plugin-contract.md)
  and escalated-laravel. Pass `@escalated-dev/plugin-sdk` `definePlugin()`
  objects as `EscalatedModule.forRoot({ plugins })`; they run in this process.
  Admin > Plugins (`Escalated/Admin/Plugins/Index`) lists them and activates,
  deactivates or uninstalls them (`onActivate`, `onDeactivate`, and the
  `plugin.activated` / `plugin.deactivated` / `plugin.uninstalling` actions);
  there is no upload. An active plugin's pages render `Escalated/Plugin/Page`
  with the props of its `GET /{component}` endpoint; its endpoints are served
  at `/escalated/api/plugins/{slug}/...` to admins (plus any declared
  capability) and its webhooks at `/escalated/webhooks/plugins/{slug}/...`.
  `ctx.config`, `ctx.store`, `ctx.http`, `ctx.log`, `ctx.emit` and
  `ctx.currentUser` work. A malformed plugin, or two with one slug, stop the
  module at boot. See `docs/plugins.md`.
- **Plugin hooks**: active plugins receive the canonical events (ADR
  2026-10-21) as actions, with the payload of the shared plugin contract (the
  ticket or reply flat, plus `ticket`/`reply` and the event's extras). A
  failing or slow plugin never affects the request. Legacy names, merged and
  split are not delivered.
- `ctx.tickets`, `ctx.replies`, `ctx.contacts`, `ctx.tags`, `ctx.departments`
  and `ctx.agents`, through the package's services, so plugin writes fire the
  usual events. Writes take only the fields the contract lists, and a plugin
  never chooses the acting user.
- Active plugins' menu items, page components and dashboard widgets are shared
  with every screen as `escalated.plugins`, filtered by capability; admin menu
  items go to admins only.
- Plugin `cron` schedules run: every minute the package's scheduler runs the
  active plugins' five-field (UTC) schedules that are due, as no user, within
  30 s each. Dashboard widgets with a `badge` function carry its answer as
  `badge`, asked as the viewer within 5 s (`null` when it fails). Nothing
  changes for hosts without plugins.

## [1.2.8] - 2026-10-28

### Upgrading
- A client that read the numeric `session_id` or `ticketId` from
  `POST widget/chat/start` should use `id` (the chat token) for the widget chat
  routes and `ticket_reference` to name the ticket. Agent chat routes still
  take the numeric session id, which agents get from their own chat lists.
- The mobile guest routes are public and always mounted, like the widget
  routes (this package has no REST-API switch). Nothing to migrate. Redact the
  `:token` path segment of `/escalated/api/v1/mobile/guest/tickets/*` from
  access logs, as you do guest grants elsewhere.
- Run the new `ChatVisitorTokenExpiry1793232000000` migration (exported from
  the package). It adds a nullable `visitorTokenExpiresAt` column to chat
  sessions. Chats already in progress keep working: the next widget request
  with their token gives it a full lifetime.
- Widget chat tokens now expire `guestAccess.ttlMinutes` after the chat starts
  (default 1440, clamped to 5 minutes .. 7 days), as in escalated-laravel.
  After that every `widget/chat/:token/*` route answers 404 and the visitor
  starts a new chat. Raise `guestAccess.ttlMinutes` if chats run longer.

### Added
- **Mobile guest API** at `/escalated/api/v1/mobile/guest`: `POST verification`,
  `POST lookup`, `POST tickets`, `GET tickets/:token` and
  `POST tickets/:token/replies`, per the shared
  [mobile-guest-api](https://github.com/escalated-dev/escalated-developer-context/blob/main/domain-model/mobile-guest-api.md)
  contract and escalated-laravel. They reuse verified guest access: the same
  email codes, grants and per-IP guest budgets as the widget and guest routes,
  so grants work across all three. A bad or expired grant is a 404; answers
  carry `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.
  See `docs/guest-access.md`.

### Changed
- `POST widget/chat/start` also returns `expires_at`, when the chat token stops
  working. Only the token's SHA-256 is stored, as before. An ended chat stays
  readable (`GET .../messages` with `ended: true`) and rateable until then.
- `POST widget/chat/start` now answers exactly as escalated-laravel: `201
  { id, session_id, expires_at, ticket_reference, status, agent_name }`, where
  `id` and `session_id` are both the chat token, plus the widget's `messages`
  and `agent`. The numeric `session_id` and `ticketId`, and `visitorName` and
  `createdAt`, are no longer returned: the token replaced them.

## [1.2.7] - 2026-10-22

### Upgrading
- Tokens are checked against their abilities now. As in Laravel, `admin` does
  not imply `agent`: a token that must reach both admin and agent routes
  needs `["agent", "admin"]` or `["*"]`. Tokens created without abilities
  through `ApiTokenService.create` default to `["*"]` and are unaffected;
  a token stored with an empty or null `abilities` list is refused on admin
  and agent routes. Review existing tokens' abilities before upgrading.

### Security
- **`ApiTokenGuard` enforces token abilities**, as escalated-laravel's
  `AuthenticateApiToken` does. It checked only that a token existed and had
  not expired, so a token issued with just the `agent` ability (or none)
  could call every admin route when the host used the guard as `adminGuard`.
  Admin routes now need the `admin` ability, agent routes need `agent`, `*`
  grants both, and a token without the needed ability gets
  `403 {"message": "Insufficient permissions."}` (its `lastUsedAt` is not
  touched). Customer routes need no ability. The route group is read from the
  Escalated group guard that is asking (`adminGuard` / `agentGuard`), or,
  when the token guard runs first (globally or listed before it), from the
  `EscalatedAdminGuard` / `EscalatedAgentGuard` on the route. Host routes can
  name an ability with the new `@ApiTokenAbility('admin')` decorator; host
  routes that name none are unchanged.

### Fixed
- The shared UI's route table now names `escalated.admin.chat.transfer`
  (escalated-laravel's name), pointing at `POST
  /escalated/agent/chat/{session}/transfer`. `Agent/TicketShow` in
  `@escalated-dev/escalated` posts the live chat Transfer menu there with
  `{"department_id"}` or `{"agent_id"}`, which this endpoint already accepts.
- The shared UI's route table now names `escalated.admin.chat.end`
  (escalated-laravel's name), pointing at `POST
  /escalated/agent/chat/{session}/end`. `Agent/TicketShow` in
  `@escalated-dev/escalated` posts End Chat there with `{}`; before, the name
  did not resolve and the button never reached the server. The endpoint is
  unchanged: ending an already-ended session still returns 400 (Laravel
  returns 422).

## [1.2.6] - 2026-10-22

### Added
- With `ui.enabled`, `Admin/Users/Index` at `/escalated/admin/users`, with
  escalated-laravel's props (`users` paginated 20 a page, `filters.search`,
  `currentUserId`) and its toggles at `PATCH /escalated/admin/users/:user/role`
  (`escalated.admin.users.index` / `escalated.admin.users.role`). Escalated
  owns no users, so two new optional host hooks back it: `ui.listUsers({
  search, page, perPage })` returns `{ data, total }`, and
  `ui.updateUserRoles(userId, { isAdmin?, isAgent? })` applies a change
  (Laravel's rules applied first: granting admin grants agent, revoking agent
  revokes admin, and an admin cannot drop their own admin access). Without
  `listUsers` the page renders empty with a `notice` prop explaining why;
  without `updateUserRoles` a toggle flashes an error and changes nothing.
  Rendered pages: 83 of 91.
- With `ui.enabled`, the admin operations screens, with escalated-laravel's
  controllers as the prop contract: `Admin/Automations/Index` and `Form`,
  `Admin/BusinessHours/Index` and `Form` (`/escalated/admin/business-hours`,
  holidays saved with the schedule, one default), `Admin/Skills/Index` and
  `Form` (routing tags, departments and agents with proficiency),
  `Admin/Capacity/Index` (`/escalated/admin/capacity`, one `default` channel
  per agent, as this backend keeps one limit per agent) and
  `Admin/AuditLog/Index` (`/escalated/admin/audit-log`, paginated, filtered by
  user, action, resource type and date; stored verbs show as Laravel's
  `created`/`updated`/`deleted`). Rendered pages: 81 of 91.
- With `ui.enabled`, `Admin/Reports/AgentDetail` at
  `/escalated/admin/reports/agent/:id/detail` (`?days=`, default 30): one
  agent's tickets, resolutions, first response and resolution averages, CSAT,
  response-time percentiles, replies and resolutions per day, workload and
  CSAT breakdown, each against the period of the same length before it. It
  sends the props the component declares (`agent`, `total_tickets`, ...), as
  escalated-rails does; Laravel's own `agent_id`/`metrics`/`percentiles` are
  not read by the component. Rendered pages: 82 of 91.

### Changed
- `GET /escalated/admin/automations` and `/escalated/admin/skills` and their
  writes answer browser and Inertia requests with the screens when
  `ui.enabled`; API clients get the same JSON as before. New
  `GET .../automations/create`, `.../automations/:id/edit` and
  `.../skills/create` exist only for the screens (404 otherwise). Nothing
  changes with `ui.enabled` off.

## [1.2.5] - 2026-10-22

### Upgrading
- **Run the exported `HashApiTokens1793145600000` migration when deploying.**
  API tokens are now stored as the SHA-256 digest of the token, and
  `ApiTokenGuard` and `ApiTokenService.validate()` look them up by digest. The
  migration hashes every stored plain token in place, so tokens already given
  to clients keep working unchanged; until it runs, those tokens are refused.
  It skips values that are already a 64-character hex digest, so running it
  twice is safe, and the schema does not change. `down()` is a no-op: the plain
  tokens cannot be recovered. Host code that inserts `ApiToken` rows itself
  (seeders, fixtures) must store `hashApiToken(plainToken)` (now exported) in
  `token`.
- Saving a webhook with the secret left blank (screen or `PUT
  /escalated/admin/webhooks/:id`) now keeps the stored secret, because pages
  and the JSON API no longer receive it; the JSON API used to store the blank
  value. Send `clear_secret: true` to remove it. Webhook JSON and page objects
  carry `has_secret` instead of `secret`; `POST /escalated/admin/webhooks`
  still returns `secret` once, so a generated one can be copied.
- `Webhook`, `ImportJob`, `ApiToken` and `AgentProfile` entities now define
  `toJSON()`, which leaves out `secret`, `credentials`, `token`,
  `twoFactorSecret` and `twoFactorRecoveryCodes`. Host code that
  `JSON.stringify`s these entities and needs the value must read the property
  directly.
- The scheduler now runs the data retention purge daily at 03:30. Every
  period defaults to `never`, so until an admin sets one on the Data retention
  page it only deletes expired guest verification codes. A closed ticket
  (status `closed`) past `retention_closed_tickets` is deleted outright with
  its replies, attachments, activities and every other row that points at it:
  tickets have no soft delete here, so there is no 30-day grace period.
  Tickets merged into it are kept and unlinked; inbound emails keep their
  record without the ticket id.
- Run the exported `ImportJobs1793059200000` migration: it creates
  `escalated_import_jobs` and `escalated_import_source_maps` for the admin
  Import wizard. Nothing existing changes.
- The Import wizard keeps tested source credentials sealed under
  `importSecret` (default: `guestAccess.secret`, then
  `ESCALATED_GUEST_ACCESS_SECRET`, then `inbound.replySecret`). Set one in a
  multi-instance or restarting deployment, or unfinished jobs cannot read
  their credentials after a restart.
- To import attachments, pass `importAttachmentStorage` (for example a
  `LocalFileAttachmentStorage` on a directory the web server does not serve);
  import adapters must send each file's bytes as `content`.
- Run the exported `CustomFieldsAndObjects1792972800000` migration: it adds
  nullable `placeholder`, `description`, `validationRules` and `conditions` to
  `escalated_custom_fields` (existing definitions keep everything) and creates
  `escalated_custom_objects` and `escalated_custom_object_records`.
- **Behaviour change:** ticket custom field values (`customFields` keyed by
  field id, and the new `custom_fields` keyed by slug) are now checked against
  the definitions before the ticket is written. Only active `ticket` fields
  are accepted, values must match their type, and the agent, customer and
  customer-screen create endpoints refuse a ticket that leaves a required
  field empty (422, or the form's field errors, keyed
  `custom_fields.<slug>`). With no custom fields defined nothing changes.
  Values are now stored as escalated-laravel stores them: `multi_select` as a
  JSON array, `checkbox` as `1`/`0`. An empty value for an optional field
  deletes the stored one.
- The `escalated/admin/custom-fields` JSON routes moved from
  `AdminSettingsController` to the new `AdminCustomFieldController`; paths,
  bodies and responses are unchanged.
- Run the exported `TicketStatusCategories1792886400000` migration: it adds
  `category`, `description` and `isSystem` to ticket statuses. Existing rows
  get a category from `isClosed` and their slug (`solved` when closed or
  slugged `resolved`/`closed`, `pending` for `waiting_on_customer`/`pending`,
  `on_hold` for `snoozed`, otherwise `open`); every solved row gets
  `isClosed`, and rows with a built-in slug (`open`, `in_progress`,
  `waiting_on_customer`, `waiting_on_agent`, `escalated`, `resolved`,
  `closed`, `reopened`, `live`, `snoozed`) become system rows. Tickets are not
  changed.
- **Behaviour change:** a status slugged `resolved` or `closed` but saved
  without `isClosed` now stamps `resolvedAt`/`closedAt` like any solved
  status (lifecycle events already treated it as closed).
- **Behaviour change:** macro `status`, workflow `change_status` and
  automation `change_status` actions now go through `TicketService`, so they
  stamp `resolvedAt`/`closedAt` for a solved status and send
  `ticket.status_changed` (plus `ticket.resolved`/`ticket.closed`/
  `ticket.reopened`) and `ticket.updated`. Automations accept a status slug as
  well as an id.
- **Behaviour change:** the Statuses screen's `is_default` is exclusive per
  category (as in escalated-laravel), not across all statuses. New tickets
  still get one default status: the default of the earliest category.
- Run the exported `EscalationRuleContract1792713600000` migration: it makes
  an escalation rule's SLA policy optional, adds `description` and
  `repeatAfterHours` to rules, and creates `escalated_rule_executions`.
  Existing rules keep their data and match the same tickets.
- **Behaviour change:** an escalation rule now acts on a ticket once, as in
  escalated-laravel, not on every five-minute run. It acts again after the
  ticket stops matching and matches again, or after the rule's
  `repeatAfterHours`. Rule actions now go through `TicketService`, so they
  send the usual `ticket.priority_changed`, `ticket.assigned` and
  `ticket.updated` events. Only open tickets (not resolved, closed or merged)
  are escalated.
- Run the exported `BusinessSchedulePrecedence1792800000000` migration: it
  adds `businessHoursOnly` (false) to SLA policies and a nullable
  `businessScheduleId` to departments. Existing policies keep their deadlines:
  a policy with its own schedule still counts business hours, and one without
  still counts calendar time.
- **Behaviour change:** saving the shared SLA policy form with
  `business_hours_only` no longer pins the default schedule onto the policy;
  it sets `businessHoursOnly`, and the schedule is chosen per ticket (see
  Added). Policies pinned before keep their schedule. `business_hours_only` is
  still refused while no business schedule exists.
- **Behaviour change:** business hours are now read in the schedule's
  `timezone` (default `UTC`) instead of the server's local zone, holidays now
  close their days, and a day saved without an `enabled` flag (the shape
  escalated-laravel and the shared form use) is open when it has a start and
  end. Days saved with `enabled: false` stay closed.

### Added
- The admin Settings sub-pages, with escalated-laravel's routes, props,
  validation and flash messages (`ui.enabled`, admins only):
  `Escalated/Admin/Settings/CsatSettings` (`escalated/admin/settings/csat`),
  `DataRetention` (`.../data-retention`, with `purgePreview`), `EmailSettings`
  (`.../email`: `email_addresses` normalised to `email`, `display_name`,
  `department_id`, `dkim_status`, and `default_reply_address`; stored only,
  as in Laravel), `PublicTickets` (`.../public-tickets`, `POST` or `PUT`,
  reading and writing the `guest_policy` setting the widget resolves) and a
  read-only `DatabaseConnection` (`.../database`, `POST .../database/test`):
  the connection is the module's `connection` option, so the page is pinned
  and a switch is refused. The route names are in the `route()` table.
- `DataRetentionService` (`purgeExpired({ dryRun })`, `preview()`):
  escalated-laravel's `escalated:purge-expired` for closed tickets,
  attachments, audit logs and expired guest verification codes.
- The admin Import wizard and the import framework behind it, as
  escalated-laravel's: the shared `Admin/Import/Index`, `Connect`, `Mapping`,
  `Review` and `Progress` pages on Laravel's paths and props under
  `/escalated/admin/import` (route names `escalated.admin.import.*`), admins
  only, with `ui.enabled`. `POST .../:platform/test-connection` answers
  `{success[, error]}` (422 when the source throws); `review` writes nothing;
  `start` creates the job and queues it; `status/:job` answers the Progress
  poll; `pause`, `resume` and `cancel` act on the job.
  - Sources are the module option `importAdapters` (the `ImportAdapter`
    interface); Escalated ships none, so a Zendesk or Freshdesk adapter is the
    host's or a plugin package's. `importUserIdByEmail` maps imported agents
    (required) and contacts (optional) to host users.
  - `ImportJob`, `ImportSourceMap` and `ImportJobService`, which resumes each
    entity type from its saved cursor, skips what is already mapped (so a
    paused, failed or interrupted run imports nothing twice), saves progress
    and an error log per batch, and stops between batches when the job is
    paused or cancelled. It imports agents, contacts (host users, else
    Escalated contacts on guest tickets), tags, departments, tickets (status
    and priority falling back to the default status and medium, requester,
    assignee, department, tags, source timestamps), replies, custom fields,
    attachments and satisfaction ratings.
  - Tested credentials wait in an HttpOnly cookie scoped to the import paths,
    sealed with AES-256-GCM, until the import starts, then on the job; never
    in a page. A completed or cancelled job drops them.
  - Imports run in the process after the response; pass `importDispatcher`
    to hand them to a queue that calls `ImportJobService.run(jobId)`.
  - Import mode (`ImportContext`, bound to the run's async context) holds back
    SLA policy attachment, SLA breach and warning checks, escalation rules and
    automations during a run.
  - Custom fields: a `custom_fields` record (`name`, `type`, `options`) is
    found by slug or created through the admin form's rules
    (`CustomFieldService.adminCreate`), as Laravel's `persistCustomField`. A
    ticket record's `custom_fields` object (`{key: value}`) becomes the
    ticket's values: the wizard's ticket field mapping decides each key
    (`"custom_fields.<slug>"` lands on that field, `""` skips it), else the key
    is a custom field source id from the same import, else a slug. Each value
    is checked by `resolveTicketInput` as a ticket update is; one that fails
    is left out and logged under `custom_field_values` with the ticket's
    source id, and the ticket is kept. Fields a record does not carry are not
    required.
  - Attachments: an `attachments` record (`parent_type` `ticket` or `reply`,
    default `reply`; `parent_source_id`, `filename`, `content` as a Buffer or
    base64) is held to Laravel's live-upload rules (`importAttachmentMaxKb`,
    default 10240; Laravel's allowed extensions; markup refused whatever the
    name; the type from the extension; the base name only) and written
    through `importAttachmentStorage` (or the `ATTACHMENT_STORAGE` provider),
    so it is served only by the authorised download route. Unlike Laravel, a
    source `path` is never trusted: a record without `content` fails, and
    with no storage every attachment fails.
  - Satisfaction ratings: a `satisfaction_ratings` record (`ticket_source_id`,
    `rating` or `score`, `comment`, `created_at`) is written on its imported
    ticket as a 1-5 integer, one per ticket, credited to the ticket's
    requester and assignee, with no rating token and none of a live rating's
    rules or effects. These three record types used to fail with "Unknown
    entity type".
- Custom fields and custom objects as escalated-laravel has them
  (CUSTOM-FIELDS-SPEC). With `ui.enabled`: `Admin/CustomFields/Index` and
  `Form` (`/escalated/admin/custom-fields`, `/create`, `/:id/edit`; `fields`
  with Laravel's keys, `contexts`), with store (the slug comes from the name,
  `_2`, `_3` when taken), update, delete (its values go with it) and
  `reorder`; `Admin/CustomObjects/Index`, `Form` and `Records`
  (`/escalated/admin/custom-objects`, `/create`, `/:id/edit`, `/:id/records`)
  with object and record create, update and delete. Record `data` is checked
  against the object's schema (errors keyed `data.<name>`), and a record
  reached through another object is a 404. API clients get the custom object
  routes as JSON (422 for invalid input).
- Ticket custom field values: agent ticket create and update, and customer
  ticket create (API and screen), take `custom_fields` keyed by field slug. `Customer/Create` gets the active
  ticket field definitions as `custom_fields`; `Customer/Show`,
  `Agent/TicketShow`, `Admin/Tickets/Show` and the agent and customer JSON
  ticket details get `custom_fields` with each field's decoded `value`
  (`multi_select` an array, `checkbox` a boolean, `number` a number). Guest and
  widget ticket creation do not take custom fields yet.
- Status categories as escalated-laravel has them: every ticket status
  belongs to `new`, `open`, `pending`, `on_hold` or `solved`, and lifecycle
  keys off the category. A custom status in the `solved` category stamps
  `resolvedAt`/`closedAt`, stops SLA and escalation, counts as closed in
  reports and queues, and closes the ticket to guest and customer replies.
  `isClosed` is kept equal to `category === 'solved'`. The Statuses screens
  offer all five categories and send `description` and `is_system`; system
  statuses keep their slug and category and cannot be deleted. Status changes
  take a custom status by slug or id on every path (agent API, screen and
  bulk actions, macros, workflows, automations). Agent and admin ticket JSON
  gains `status_category` and `custom_status`; customer and guest tickets
  gain `status_category`. See `docs/ui.md` ("Status categories").
- Business-hours SLA deadlines are counted as escalated-laravel counts them.
  For a policy limited to business hours (`businessHoursOnly`, or a policy with
  its own `businessScheduleId`), `SlaService` uses the policy's schedule, else
  the ticket department's `businessScheduleId`, else the default schedule
  (`isDefault`), and calendar time when none applies. The new calculator
  (`addBusinessMinutes`, `isWithinBusinessHours`, exported) reads hours as
  wall-clock times in the schedule's zone and counts real elapsed time across
  daylight-saving changes (an opening skipped by spring-forward opens at the
  change), honours one-off and recurring holidays on the local date (an
  overnight window that opens on a holiday is closed), supports overnight
  windows and `24:00`, and counts calendar time for a schedule with no open
  day.
- SLA policy and department screens accept `business_schedule_id` (nullable;
  an unknown id is a field error), changed only when the form sends it. The
  `Admin/SlaPolicies/Form` and `Admin/Departments/Form` pages receive a
  `schedules` prop (`[{id, name}]`, by name) for the shared frontend's
  **Business hours schedule** picker, and the department form's `department`
  carries `business_schedule_id`. The SLA policy form's
  `business_hours_only` reflects `businessHoursOnly` as well as an own
  schedule. Deleting a business schedule clears it from policies and
  departments.
- Escalation rule screens (with `ui.enabled`): `Admin/EscalationRules/Index`
  and `Form` (`/escalated/admin/escalation-rules`), with create, update and
  delete, as escalated-laravel's EscalationRuleController. Rules take
  escalated-laravel's shape (`conditions` as `[{ field, value }]`, actions
  `escalate`, `change_priority`, `assign_to`, `change_department`, `order`,
  `description`, `repeat_after_hours`), so rules saved from the shared form
  fire. Rules saved before keep matching as they did and are shown in that
  shape (see `docs/ui.md`); the JSON routes under `/escalated/admin/sla`
  accept both shapes, and the earlier action names `reassign` and
  `set_priority`.
- Report screens (with `ui.enabled`): `Admin/Reports` and
  `Admin/Reports/Dashboard`, `AgentMetrics`, `SlaReport`, `CsatReport`,
  `SlaTrends`, `ResponseTimes`, `ResolutionTimes`, `AgentRanking`, `Cohorts`
  and `Comparison` under `/escalated/admin/reports`, with the props and route
  names of escalated-laravel's ReportController, computed by a new
  `ReportingService` with queries that run the same on PostgreSQL, MySQL and
  SQLite. `GET /escalated/admin/reports/export/:type` exports a report as CSV
  or JSON (admin guard; audit-logged). See `docs/ui.md`.
- Admin ticket screens (with `ui.enabled`): `Escalated/Admin/Tickets/Index`
  (`GET /escalated/admin/tickets`, with `agents` and `savedViews`) and
  `Escalated/Admin/Tickets/Show` (`GET /escalated/admin/tickets/:reference`,
  with `agents` and `is_snoozed`), as escalated-laravel's Admin
  TicketController sends them. The admin ticket actions (`reply`, `note`,
  `assign`, `status`, `priority`, `tags`, `department`, `macro`, `follow`,
  `snooze`, `unsnooze`), bulk actions (`POST /escalated/admin/tickets/bulk`)
  and the saved views sidebar (`/escalated/admin/saved-views`, own views
  only) are served under the `escalated.admin.*` route names the screens call.
- The staff ticket screens now send the ticket's `satisfaction_rating`.
- Admin configuration screens (with `ui.enabled`): `Admin/SlaPolicies/Index`
  and `Form`, `Admin/Statuses/Index` and `Form`, `Admin/Macros/Index`,
  `Admin/CannedResponses/Index`, `Admin/Webhooks/Index`, `Form` and
  `DeliveryLog`, with their create/update/delete forms and webhook delivery
  retry, as escalated-laravel's admin controllers serve them. See
  `docs/ui.md` for how each maps onto this backend.
- People screens (with `ui.enabled`): `Admin/Roles/Index` and `Form` on the
  roles JSON routes (create, update with the permission matrix, delete), and
  `Admin/ApiTokens/Index` on the API token routes (a new token's plain value
  is flashed once as `plain_text_token`; tokens can be issued to active
  agents only).
- Knowledge base screens (with `ui.enabled`): `Admin/KnowledgeBase/Articles/Index`
  and `Form` (`/escalated/admin/kb-articles`), `Admin/KnowledgeBase/Categories/Index`
  (`/escalated/admin/kb-categories`), and the public
  `Customer/KnowledgeBase/Index` and `Article` (`/escalated/kb`, with helpful
  feedback), as escalated-laravel serves them. Off with
  `enableKnowledgeBase: false`.
- Guest screens (with `ui.enabled`): `Guest/Create` (`/escalated/guest/create`)
  files a ticket with an emailed verification code and redirects to
  `Guest/Show` (`/escalated/guest/:grant`) through an expiring grant, with
  guest replies and ratings, as escalated-laravel's Guest\TicketController.
  The guest policy helpers move to `services/guest-policy.ts`, shared with
  the widget.
- `Admin/Workflows/Logs` (with `ui.enabled`) on `GET
  /escalated/admin/workflows/logs`, with the workflows to filter by; the JSON
  route also takes the screen's `?workflow=` filter.
- `WebhookService.retryDelivery(id)` sends one stored delivery again now.
- Macros run escalated-laravel's action names (`status` by slug, `priority`,
  `assign`, `tags` (adds), `department`, `reply`, `note`) as well as the
  existing `set_status`, `set_priority`, `set_department`, `assign`,
  `add_reply`, `add_note`.

### Changed
- The bundled widget is now `@escalated-dev/escalated` 0.12.4. The widget's source did not change in 0.12.4; the bundle is rebuilt with the frontend's newer build tools, so it behaves as before.

### Security
- **API tokens are no longer stored in plain text.** `escalated_api_tokens.token`
  held each token itself, so anyone who could read the table (a backup, a
  replica, a SQL injection elsewhere in the host) could call the API as that
  token's user. It now holds the SHA-256 digest, as escalated-laravel stores
  it. `POST /escalated/admin/api-tokens` still returns the plain token once
  (`plainTextToken`, or the `plain_text_token` flash on the admin screen);
  no response carries the digest. Abilities, expiry and revocation work as
  before.
- **Stored secrets are no longer sent to admin pages or the admin JSON API.**
  The webhook index, edit and delivery-log pages, and the webhook JSON list,
  show and update responses, carried each webhook's signing secret. The API
  token JSON list (`GET /escalated/admin/api-tokens`) returned every token's
  stored value, which is the token itself, and the agent JSON API
  (`GET /escalated/admin/agents`, `/:id`, and the create/update responses)
  returned each agent's two-factor secret and recovery codes. All of these are
  now left out; webhooks expose `has_secret` instead. The import pages and
  status JSON were already built from an explicit field list and are now
  guarded by the same test. A new API token is still shown once, on creation,
  and two-factor setup (`POST /escalated/admin/2fa/generate`) still returns
  the new secret and recovery codes once.

### Fixed
- `SlaService.addBusinessMinutes` looped forever on a schedule with no
  enabled day; such a schedule now counts calendar time.

## [1.2.4] - 2026-10-21

### Upgrading
- **Breaking for guests (verified guest access):** a widget ticket with an
  `email` and a widget chat now need the emailed code. Deploy a widget with the
  code step first, run the exported `VerifiedGuestAccess1792627200000`
  migration, set `guestAccess.secret` (or `ESCALATED_GUEST_ACCESS_SECRET`) to
  the same value on every instance, and configure `mail` or
  `guestAccess.sendCode`. Permanent guest tokens stop opening tickets unless
  `guestAccess.legacyTokens: true` is set for a transition. See
  `docs/guest-access.md`.
- Register and run the exported `SlaWarningFlags1792540800000` migration
  (adds `slaFirstResponseWarned` and `slaResolutionWarned` to tickets).
- Webhook event names changed: public replies are sent as `reply.created`
  (was `ticket.reply_created`) and internal notes only as `note.created`.
  Stored subscriptions under old names keep receiving the canonical event.
- Unassigning a ticket emits `TICKET_UNASSIGNED` instead of `TICKET_ASSIGNED`
  with a null assignee; update host listeners that relied on the old shape.

### Added
- **The shared screens (Inertia UI), behind `ui.enabled`** (default `false`,
  so API-only hosts are unchanged; escalated-laravel defaults to `true`, and
  this default will flip in a future minor). A full Inertia protocol layer:
  HTML first visits from a host-overridable root view (`ui.rootView`), JSON
  page objects for `X-Inertia` visits, the asset version check (`409` +
  `X-Inertia-Location`), partial reloads, `303` redirects back after forms
  with flash messages and field `errors` (in an `escalated_flash` cookie), and
  Laravel's shared props (`auth.user`, `flash`, `errors`, `escalated.prefix`,
  `is_agent`, `is_admin`, ...) plus a `ziggy` route table and a `route()`
  helper for the shared components. See `docs/ui.md`.
- Agent screens: `Escalated/Agent/Dashboard` (`GET /escalated/agent`),
  `Agent/TicketIndex` and `Agent/TicketShow`, and the ticket actions the ticket
  screen posts: `reply`, `note`, `assign`, `status`, `priority`, `tags`,
  `department`, `macro`, `follow` under `/escalated/agent/tickets/:ticket/`.
  Customer screens: `Escalated/Customer/Index` (`GET /escalated` and the
  customer ticket list), `Customer/Create` (`GET /escalated/create`, posting
  to `POST /escalated`), `Customer/Show` (`GET
  /escalated/customer/tickets/:ticket`, the allow-listed requester payload
  without internal notes), and `reply`, `close`, `reopen` and `rate` under
  `/escalated/customer/tickets/:ticket/`.
  Admin screens: `Escalated/Admin/Settings` (with `supported_settings`, the
  keys this backend stores: `show_powered_by` and the widget appearance and
  allowed origins; saved by `POST /escalated/admin/settings`),
  `Admin/Workflows/Index` and `Admin/Workflows/Form` (create and edit, on the
  workflow admin routes and the builder's wire contract, with field errors),
  `Admin/Departments/Index` and `Form`, and `Admin/Tags/Index`.
  Pages not rendered yet (68 of 91, tracked in
  `test/page-name-parity.spec.ts`): `Admin/ApiTokens/Index`,
  `Admin/AuditLog/Index`, `Admin/Automations/Form`,
  `Admin/Automations/Index`, `Admin/BusinessHours/Form`,
  `Admin/BusinessHours/Index`, `Admin/CannedResponses/Index`,
  `Admin/Capacity/Index`, `Admin/CustomFields/Form`,
  `Admin/CustomFields/Index`, `Admin/CustomObjects/Form`,
  `Admin/CustomObjects/Index`, `Admin/CustomObjects/Records`,
  `Admin/EscalationRules/Form`, `Admin/EscalationRules/Index`,
  `Admin/Import/Connect`, `Admin/Import/Index`, `Admin/Import/Mapping`,
  `Admin/Import/Progress`, `Admin/Import/Review`,
  `Admin/KnowledgeBase/Articles/Form`, `Admin/KnowledgeBase/Articles/Index`,
  `Admin/KnowledgeBase/Categories/Index`, `Admin/Macros/Index`,
  `Admin/Plugins/Index`, `Admin/Reports`, `Admin/Reports/AgentDetail`,
  `Admin/Reports/AgentMetrics`, `Admin/Reports/AgentRanking`,
  `Admin/Reports/Cohorts`, `Admin/Reports/Comparison`,
  `Admin/Reports/CsatReport`, `Admin/Reports/Dashboard`,
  `Admin/Reports/ResolutionTimes`, `Admin/Reports/ResponseTimes`,
  `Admin/Reports/SlaReport`, `Admin/Reports/SlaTrends`, `Admin/Roles/Form`,
  `Admin/Roles/Index`, `Admin/Settings/CsatSettings`,
  `Admin/Settings/DataRetention`, `Admin/Settings/DatabaseConnection`,
  `Admin/Settings/EmailSettings`, `Admin/Settings/PublicTickets`,
  `Admin/Settings/Sandbox`, `Admin/Settings/SsoSettings`,
  `Admin/Settings/TwoFactor`, `Admin/Skills/Form`, `Admin/Skills/Index`,
  `Admin/SlaPolicies/Form`, `Admin/SlaPolicies/Index`,
  `Admin/Statuses/Form`, `Admin/Statuses/Index`, `Admin/Tickets/Index`,
  `Admin/Tickets/Show`, `Admin/Users/Index`, `Admin/Webhooks/DeliveryLog`,
  `Admin/Webhooks/Form`, `Admin/Webhooks/Index`, `Admin/Workflows/Builder`,
  `Admin/Workflows/Logs`, `Auth/TwoFactorChallenge`,
  `Customer/KnowledgeBase/Article`, `Customer/KnowledgeBase/Index`, `Error`,
  `Guest/Create`, `Guest/Show`, `Plugin/Page`.
- The shared event vocabulary (ADR 2026-10-21). New events, each sent to
  webhooks and offered as a workflow trigger under its canonical name:
  `ticket.unassigned`, `ticket.department_changed`, `ticket.priority_changed`,
  `ticket.tag_added`, `ticket.tag_removed`, `ticket.resolved`,
  `ticket.closed`, `ticket.reopened`, `ticket.escalated`, `note.created`,
  `sla.warning`, and the live chat events `chat.started`, `chat.assigned`,
  `chat.transferred`, `chat.message`, `chat.ended` (previously never sent to
  webhooks). Workflows also fire on `sla.breached` and the chat events.
- `POST /escalated/agent/chat/:sessionId/transfer` (`agent_id` and/or
  `department_id`) hands a live chat to another agent or back to a
  department's queue.
- `slaWarningMinutes` option (default `30`; `0` turns warnings off).
  **Upgrade:** register and run the exported `SlaWarningFlags1792540800000`
  migration, which adds `slaFirstResponseWarned` and `slaResolutionWarned` to
  tickets.
- Workflow admin JSON API under `/escalated/admin/workflows` (admin guard):
  index, show, store, update, destroy, toggle, reorder, logs and the builder's
  form options. It accepts exactly the body the shared builder posts
  (escalated-developer-context `domain-model/workflow-admin-contract.md`) and
  answers `422` with `errors` per field. See `docs/workflows.md`.
- Verified guest access, as in escalated-laravel (`docs/guest-access.md`):
  `POST verification` and `POST lookup` on `/escalated/widget` and the new
  `/escalated/guest` routes, emailed eight-digit codes (10 minutes, 5
  guesses, single use, per-mailbox budgets), and expiring, encrypted guest
  grants whose nonce is stored only as a hash. Widget `/config` now answers
  `guest_verification_required: true` and `status_lookup_enabled: true`.
  New `guestAccess` options. **Upgrade:** run the exported
  `VerifiedGuestAccess1792627200000` migration, set `guestAccess.secret` (or
  `ESCALATED_GUEST_ACCESS_SECRET`) to the same value on every instance, and
  configure `mail` or `guestAccess.sendCode`.
- `POST /escalated/widget/chat/start` is rate limited per client IP
  (`guestRateLimit.chatsPerMinute`, default 5).

### Changed
- `GET /escalated/agent/tickets/:id` and `POST .../:id/actions/:action` also
  accept a ticket reference. A value that is neither an id nor a reference now
  answers `404` instead of `400`.
- `GET /escalated/customer/tickets/:id` and `POST .../:id/rate` also accept a
  ticket reference, and a rating must be a whole number from 1 to 5 (a
  non-numeric rating used to be stored).
- With `ui.enabled`, the admin settings, department, tag and workflow routes
  refuse a state-changing browser request (asking for HTML) that carries
  neither `X-Inertia` nor `X-Requested-With`. API clients are unaffected.
- The newsletter admin controllers' `inertia()` / `redirect()` results become
  real Inertia responses when `ui.enabled`; unchanged JSON otherwise.
- **Breaking for guests (as in Laravel):** a widget ticket with an `email`
  and a widget chat need the emailed code (`verification_id`,
  `verification_code`); deploy a widget with the code step first. Widget
  ticket creation answers `{ message, reference, ticket_reference,
  guest_access_token, expires_at }`, where the token is an expiring grant. The
  `ticket` object and `guestAccessToken` are gone. `GET` and `POST replies` on
  `/escalated/widget/tickets/:reference` take the grant
  (`Authorization: Bearer`) and answer the status shape the widget reads.
  Permanent guest tokens stop opening tickets unless
  `guestAccess.legacyTokens: true` is set for a transition.
- **Webhook event names:** public replies are sent as `reply.created`
  (was `ticket.reply_created`); internal notes are sent only as `note.created`
  (they were sent as `ticket.reply_created`). Subscriptions stored with
  `ticket.reply_created` or any ADR legacy name keep receiving the event under
  its canonical name, and saving a webhook stores canonical names.
- **Unassigning** a ticket emits `TICKET_UNASSIGNED` instead of
  `TICKET_ASSIGNED` with a null assignee. Host listeners that relied on the old
  shape should listen to `ESCALATED_EVENTS.TICKET_UNASSIGNED`.
- Changing a ticket's department records an activity, is included in
  `ticket.updated` changes, and emits `ticket.department_changed` (it was
  silent). Tag changes are included in `ticket.updated` changes.
- Internal notes no longer fire `reply.created` workflows; they fire
  `note.created`.
- Chat events are emitted as `ChatStartedEvent`, `ChatAssignedEvent`,
  `ChatTransferredEvent`, `ChatMessageEvent` and `ChatEndedEvent` instances with
  the same fields as before. `CHAT_ACCEPTED` is deprecated and still emitted
  beside `CHAT_ASSIGNED`.
- A workflow `change_status` to the status the ticket already has is a no-op.

### Fixed
- Workflow conditions on `status` (the status slug), `assigned_to`, `tags`
  (tag names), `hours_since_created` and `hours_since_updated` are evaluated;
  they never matched before. Conditions read the ticket as stored, after the
  change that fired the trigger.
- `add_tag`/`remove_tag` workflow actions find the tag by name, as the builder
  sends it (slug and id still work).
- `ticket.status_changed`, `ticket.assigned` and `ticket.updated` events carry
  the updated ticket instead of the copy read before the change.

## [1.2.3] - 2026-10-20

### Security
- WebSocket gateway (`enableWebsockets: true`): every connection must now
  identify a host user (new `websocketAuth` option, else `userResolver` on the
  handshake request, else a handshake `user`) or present a guest token
  (`handshake.auth.guestToken`) or widget chat token (`handshake.auth.chatToken`);
  anything else is disconnected. This applies with the default
  `visibility: 'all'`, not only with restricted access. New tickets, the chat
  queue, SLA and assignment events go to agent sockets only; internal notes are
  never sent to guest or customer sockets; guest tokens are stripped from every
  payload. Agent roles come from `ticketAccess.resolveUser`; without it an
  identified user is treated as a customer.
- Attachment downloads check ownership like Laravel's `AttachmentAccess`:
  customers only get attachments on tickets they requested, never ones on
  internal notes; agents are checked against ticket access.
- Customers can no longer rate another customer's ticket
  (`POST /escalated/customer/tickets/:id/rate`).
- Agent live chat takes the agent from authentication. `agentId` in the body
  or query of `accept`, `messages` and `active` is ignored, so a restricted
  agent can no longer bypass department visibility by naming another agent.

### Changed
- The bundled widget is now `@escalated-dev/escalated` 0.12.3. It keeps its script settings when `embed.js` is placed in the page `<head>`, and Enter no longer picks a stale mention suggestion.
- **Behaviour change for misconfigured hosts:** agent and admin routes that
  act as a user (ticket replies, notes, assignment, side conversations,
  macros, API tokens, imports, 2FA, agent chat) now answer `401` when the host
  guard admits a request without setting `req.user.id` (or an API token's
  `req.apiUserId`). They previously acted as user id `1`.

### Fixed
- `sla.breached` fires once per missed deadline instead of every scheduler
  tick. Tickets get `slaFirstResponseBreached` and `slaResolutionBreached`
  flags (as in Laravel); existing installations run the exported
  `SlaBreachFlags1792454400000` migration, which backfills tickets already
  breached.
- Customers are no longer emailed copies of their own replies (inbound email,
  widget); only replies by someone else are sent to the requester.
- The module boots with `enableNewsletters: true` (the newsletter module could
  not resolve the package options).

## [1.2.2] - 2026-10-19

## [1.2.1] - 2026-10-19

### Changed
- The bundled widget is now `@escalated-dev/escalated` 0.12.2. It hides its Check Status tab when `/config` returns `status_lookup_enabled: false`.

### Added

- Opt-in department/account query visibility across staff HTTP, token API,
  widgets, reports, bulk operations, linked records and live updates.
- Host account resolvers, indexed account identities, account/type routing
  conditions and deterministic department/type SLA targeting.
- Migration and access CI coverage on PostgreSQL and MySQL.
- The widget can be embedded on other sites. List them in the `widgetOrigins`
  option, `ESCALATED_WIDGET_ALLOWED_ORIGINS` or the `widget_allowed_origins`
  admin setting (`https://*.example.com` covers subdomains). Listed origins
  get CORS on every `/escalated/widget/*` route, including preflights and
  error answers, and always run as guests. Nothing changes until a site is
  listed. See `docs/embedding-the-widget.md`.
- `GET /escalated/widget/embed.js` serves the standalone widget bundle from
  `@escalated-dev/escalated` 0.12.1.
- `GET /escalated/widget/config` returns colour, position, greeting, active
  departments, `kb_enabled`, `guest_tickets_enabled` and
  `accepts_metadata: true`.
- Widget tickets and chats keep host parameters sent as `metadata` (a
  sanitised flat map, with `embedded_on` set from the request's Origin) in a
  new nullable `metadata` column on tickets. Existing installations run the
  exported `WidgetTicketMetadata1792281600000` migration.
- The widget API matches the shared widget: `GET /escalated/widget/articles`
  and `/articles/:slug`, a top-level `reference` and `guest_access_token` on
  `POST /tickets` (existing keys kept), `department_id` on ticket create, chat
  start and availability (validated against active departments), and
  `GET /chat/:id/messages`, `POST /chat/:id/typing` and `/chat/:id/rate`.
  `/config` returns `status_lookup_enabled: false`, so the widget hides its
  Status tab.

### Changed

- `widgetOrigins` defaults to `[]` instead of `['*']`. The old value was never
  applied; a bare `*` is now ignored rather than allowing every site.

### Security

- Widget chat routes no longer accept the sequential session id. `POST
  /chat/start` returns a random token as `id` (the numeric id moves to
  `session_id`), only its SHA-256 is stored, and `/chat/:id/*` answers 404 for
  anything else. Before, anyone could post into or end another visitor's chat
  by guessing its number. Existing installations run the exported
  `WidgetChatVisitorToken1792368000000` migration; chats started before it
  cannot be continued from the widget.

### Fixed

- Automation scans no longer query a nonexistent deletedAt column.
- Chat routing stores the selected department on the underlying ticket.


## [1.2.0] - 2026-10-08

This release changes how inbound email is matched to tickets and throttles the guest widget endpoints. Read **Upgrading** before deploying.

### Upgrading

- **Inbound replies are accepted only from the ticket's requester.** A matched email becomes a reply only when `From` is the ticket's requester (the ticket's Contact, or a Contact linked to the requester user), and it is posted as that requester. Every other sender, including an agent answering a notification by email, gets a new ticket of their own. Agents should reply in the app.
- **With `inbound.replySecret` configured, only the signed Reply-To address identifies a ticket.** Header and `[TK-XXX]` subject matching are used only when no secret is set, so replies to mail sent before the secret was configured open new tickets.
- **Guest widget endpoints are rate-limited per client IP** by default: `POST widget/tickets` at 5 a minute and `POST widget/tickets/:id/replies` at 10 a minute, answering 429 with `Retry-After`. Reply attempts with a wrong guest token count too. Configure with the new `guestRateLimit` option (`enabled`, `ticketsPerMinute`, `repliesPerMinute`, `storage`). The default store is in-memory per process; pass a shared `ThrottlerStorage` (for example Redis-backed) when running more than one instance. Behind a proxy, configure the HTTP adapter's `trust proxy`, or every guest shares the proxy's address.

### Security — guest widget endpoints are rate-limited per IP

- `ThrottlerModule` was registered but no `ThrottlerGuard` was applied, so the documented global limit was never enforced, guest replies had no limit, and the per-email ticket limit could be bypassed by changing the email. A new `GuestThrottleGuard` counts per client IP with separate ticket and reply buckets; on ticket creation it runs before the existing per-email limit, and on replies it runs before the guest token check (#130).

### Security — inbound email replies must come from the requester

- An inbound email that matched a ticket by `In-Reply-To` / `References` or a `[TK-XXX]` subject reference was added as a reply whatever its sender. A matched email is now a reply only when `From` is the ticket's requester (the ticket's Contact, or a Contact linked to the requester user), and it is posted as that requester. Any other sender gets a new ticket of their own.
- With `inbound.replySecret` configured, only the signed Reply-To address identifies a ticket; header and subject matching are used only when no secret is set.

## [1.1.1] - 2026-09-13

### Fixed — the module could not boot

- `EscalatedModule.forRoot()` failed at startup with "Nest can't resolve dependencies of the EscalatedSchedulerService … AutomationService". The scheduler injected `AutomationService`, but the module registered neither that service, nor the `Automation` entity, nor `AdminAutomationController`. All three are registered now, and a test boots the real module (#114).

### Security — admin, agent and customer routes enforce the configured guards

- `adminGuard`, `agentGuard` and `customerGuard` were documented but never read, and no controller applied a guard, so every `/escalated/admin/*` and `/escalated/agent/*` route answered anonymous requests. They are now enforced on their route groups: `adminGuard` on `/escalated/admin/*`, `agentGuard` on `/escalated/agent/*`, `customerGuard` on `/escalated/customer/tickets/*`, and either `agentGuard` or `customerGuard` on `/escalated/attachments/*`.
- **Fail closed.** A group whose guard is not configured refuses every request with 403 and logs a warning once. Hosts that relied on the routes being open must configure the guards.
- A guard may be a `CanActivate` class or instance. A class the host registers as a provider is used as that instance; otherwise it is created with dependency injection.
- Public surfaces keep their own auth model: widget and widget chat, the customer knowledge base, inbound email webhooks, `/escalated/api/v1/auth/*`, and newsletter tracking and ESP webhooks (#115).

### Fixed — outbound webhooks were never delivered

- `WebhookService` listens on `escalated.**`, but the event emitter was created without wildcards, so the listener never matched and no webhook ever received a delivery. Wildcards are on now. Every event name is dot-delimited and contains no `*`, so exact-name listeners still match only their own event. A host listener whose name contains `*` now acts as a pattern (#116).

### Security — webhook URLs must resolve to public addresses

- Webhook URLs that are, or resolve to, loopback, private, link-local (including cloud metadata endpoints) or reserved addresses are refused when saved (400) and checked again before every delivery and retry. Redirects are not followed (#116).

### Fixed — fresh installs on PostgreSQL and SQLite

- Entities declared date columns as `datetime`, which PostgreSQL rejects, and as `timestamp`, which SQLite rejects, so schema synchronization failed on both; only MySQL worked. All 26 date columns now use `type: Date`, which TypeORM maps per database the same way it already maps the created/updated columns. A CI job synchronizes the schema against PostgreSQL. **Existing MySQL installs** will see 16 columns altered from `timestamp` to `datetime` on the next synchronize (#117).

### Security — the widget no longer trusts a body-supplied `requesterId`

- `POST /escalated/widget/tickets` took `requesterId` from the unauthenticated request body when no email was given, so anyone could file a ticket into another user's account. Without an `email`, the requester is now the host-authenticated `req.user`; otherwise the request gets 400. A body `requesterId` is ignored. The shipped widget uses the email path and is unaffected (#118).

## [1.1.0] - 2026-09-11

### Added — configurable database connection

- `connection` on `EscalatedModule.forRoot()` names the TypeORM DataSource that Escalated's own tables live on. Unset means the default DataSource, which is the historical behaviour and leaves an unconfigured host unchanged.

  Every service injects its repository with a plain `@InjectRepository(X)`, which binds the default DataSource's token at class-definition time — 164 of them, long before a runtime connection name is known. The entities are registered against the named DataSource and the default repository tokens are aliased onto it, so the package follows the host's choice without threading a name through every decorator.

  `NewsletterModule` became a dynamic module for the same reason: its entities are part of the same schema and must not be left behind on the default connection when the host has moved everything else.

  Your user entity is deliberately not moved — it belongs to the host, and Escalated stores host user ids as plain unconstrained columns so the two can live on different connections.

### Added — `add_follower` workflow action

- New `add_follower` workflow action subscribes a host-app user as a **follower** of the matched ticket — a notification target alongside the assignee and requester. Combined with a condition (e.g. `departmentId equals 5`), admins can auto-add followers to tickets in a given department without writing host code (resolves the request in escalated-dev discussion #88). The action's `value` is a host user key, parsed the same way as `assign_agent` (trimmed, stored as-is) so it is safe for integer- and uuid/string-keyed hosts alike. Idempotent: a user can't double-follow (unique `(ticketId, userId)`).
- New **`TicketFollower`** entity / `escalated_ticket_followers` table — minimal join row `(ticketId, userId, createdAt)`; host apps wanting richer follower semantics (notification prefs, unsubscribe) can extend it.

### Added — Centralized translations

- Translations now consumed from the central `@escalated-dev/locale` npm package via `nestjs-i18n`. New `EscalatedI18nModule` configures a chained `ChainedI18nLoader` that merges, in order: central package → `src/i18n/overrides/` → optional host-app path (`EscalatedModuleOptions.i18nOverridesPath`). Later sources win key-by-key. New options: `fallbackLanguage` (default `'en'`), `i18nOverridesPath`.

### Added — Public ticket system

Zendesk-style public ticketing: non-authenticated users can submit tickets via form or inbound email, be routed automatically by admin-configured Workflows, and receive threaded outbound email.

- **`Contact` entity** — first-class identity for guest requesters. Deduped by email (unique index, case-insensitive). Links to a host-app user via `userId` when the guest creates an account.
- **`ContactService`** — `findOrCreateByEmail`, `linkToUser`, `promoteToUser` (back-stamps `requesterId` on all prior tickets when a guest accepts a signup invite).
- **`Ticket.contactId` column** — nullable int; `requesterId` kept for host-app user references (backwards compat).
- **Public widget submission** — `POST /escalated/widget/tickets` now accepts `{ email, name?, subject, description, priority? }`. Legacy `{ requesterId, ... }` path still works. Per-email rate limit (10 / hour) via `PublicSubmitThrottleGuard`.
- **Configurable guest identity policy** — `EscalatedModuleOptions.guestPolicy`:
  - `unassigned` → `ticket.requesterId = 0`
  - `guest_user` → `ticket.requesterId = guestUserId` (configured shared user)
  - `prompt_signup` → `requesterId = 0` + `escalated.signup.invite` event emitted
  - Runtime override via settings store (`PUT /escalated/admin/settings`, `{ key: 'guest_policy', type: 'json' }`).
- **Workflow executor is live** — `WorkflowEngineService` is now wired to the event bus via new `WorkflowRunnerService` + `WorkflowListener`. Workflows with matching `triggerEvent` (`ticket.created`, `ticket.updated`, `ticket.assigned`, `ticket.status_changed`, `reply.created`) fire automatically. `stopOnMatch` honored. Executor errors caught per-workflow and stamped on the `WorkflowLog` row.
- **Workflow action catalog**: `change_priority`, `add_tag`, `remove_tag`, `change_status`, `set_department`, `assign_agent`, `add_note`, `insert_canned_reply` (`{{field}}` interpolation against the ticket).
- **Outbound email** — `EmailService` with three transactional templates (`ticket_created`, `reply_posted`, `signup_invite`). Every outbound message sets `Message-ID: <ticket-{id}[-reply-{replyId}]@{replyDomain}>`, `X-Escalated-Ticket-Id`, and a signed `Reply-To: reply+{id}.{hmac8}@{replyDomain}` address. Reply emails also set `In-Reply-To` / `References` → ticket's initial Message-ID so MUAs thread correctly.
- **Inbound email** — `POST /escalated/webhook/email/inbound` (guarded by `InboundWebhookSignatureGuard` — constant-time compare of `X-Escalated-Inbound-Secret` against `options.inbound.webhookSecret`). Postmark parser ships today. `InboundRouterService` resolves the target ticket by priority order:
  1. `In-Reply-To` / `References` header → ticket id from our Message-ID
  2. Envelope `To` matches signed Reply-To address
  3. Subject contains `[TK-XXX]` reference number
  4. Otherwise: resolve/create Contact, create new ticket

  Every webhook call writes an `InboundEmail` audit row with parsed summary + outcome.
- **Conditional `MailerModule` registration** — only registered when `options.mail` is present. Modules boot without mail configured; `EmailService` no-ops silently.
- **New config options** on `EscalatedModuleOptions`: `mail` (SMTP or named-service transport), `inbound` (replyDomain, replySecret, webhookSecret, provider), `guestPolicy`.
- **Event additions**: `escalated.signup.invite` event + `TicketSignupInviteEvent` class.
- **New entities registered**: `Contact`, `InboundEmail`, `Workflow`, `WorkflowLog` (latter two existed but were not previously registered with TypeORM).
- **Test infrastructure**: `test/factories/` with `buildTicket`, `buildWorkflow`, `buildContact` — previously had no shared factories.

### Migration notes

- **New tables**: `escalated_contacts`, `escalated_inbound_emails`, plus the already-defined-but-newly-registered `escalated_workflows` and `escalated_workflow_logs`.
- **New column on `escalated_tickets`**: `contactId INT NULL`.
- **Host-framework adapters** (Laravel, Rails, Django, etc.) that ship their own migrations need to add these tables and the nullable `contactId` column. For NestJS-only deployments using `synchronize: true`, TypeORM handles it automatically.
- **Widget payload**: callers sending a POST without `email` AND without `requesterId` will receive 400. If you embedded the widget before this change, pass `email` (recommended) or a real host-app user id.
- **Workflows now execute**: if you have inactive-but-present Workflow rows, double-check their `isActive` flag before deploying — previously the runner wasn't wired, so any stale rows set to `isActive = true` will start firing.

### Testing

- Jest suite: 232 tests passing (up from 100 pre-public-ticket).
- New specs cover: Contact entity/service, public widget path + guest policy, per-email throttle guard, WorkflowExecutor (7 actions + dispatch), WorkflowRunner, WorkflowListener, end-to-end workflow integration via real `EventEmitterModule`, message-id utilities, EmailService + templates, EmailListener (including error-swallowing), Postmark parser, InboundRouter (4-priority resolution), InboundEmailController + signature guard.

## [1.0.0] - 2026-04-18

Initial tagged release.

### Added

- Full NestJS module: TypeORM entities for `Ticket`, `Reply`, `Department`, `Tag`, `SlaPolicy`, `AgentProfile`, `EscalationRule`, `CannedResponse`, `Macro`, `ChatSession`, `Workflow`, etc.; controllers under Customer / Agent / Admin / Widget; guards for API tokens, permissions, knowledge base; mailers; broadcasting; saved views; SLA engine; chat routing.
- Docker dev/demo environment scaffold under `docker/` (excluded from the npm `files`). 3-container Postgres compose stack + minimal NestJS host that imports the package via `npm pack` tarball, registers TypeORM + EscalatedModule, and exposes a `/demo` click-to-login picker. (#14, draft)

### Fixed

- **Postgres compatibility for entity columns** ([#15](https://github.com/escalated-dev/escalated-nestjs/pull/15), fixes [#13](https://github.com/escalated-dev/escalated-nestjs/issues/13)) — 7 entities used `@Column({ type: 'datetime' })`, a MySQL-only TypeORM column type. On Postgres, `DataSource.initialize()` crashed with `DataTypeNotSupportedError: Data type "datetime" ... is not supported by "postgres"`. Switched to `type: 'timestamp'`, which TypeORM maps to `timestamp without time zone` on Postgres, `TIMESTAMP` on MySQL/MariaDB (no migration needed — same underlying type), and ISO8601 TEXT on SQLite.
- **Test specs drifted from service signatures** ([#16](https://github.com/escalated-dev/escalated-nestjs/pull/16)) — `ticket.service.spec.ts` was missing the `TicketLinkRepository` provider that `TicketService`'s constructor added; `agent-ticket.controller.spec.ts` mocked an outdated `TicketService` interface. Added missing repo provider + mock methods, swapped `toEqual(mockTicket)` to `toMatchObject` so test passes despite the controller now enriching the ticket payload. CI on `main` was previously red since #12.
