# Changelog

All notable changes to `@escalated-dev/escalated-nestjs` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- `WebhookService.retryDelivery(id)` sends one stored delivery again now.
- Macros run escalated-laravel's action names (`status` by slug, `priority`,
  `assign`, `tags` (adds), `department`, `reply`, `note`) as well as the
  existing `set_status`, `set_priority`, `set_department`, `assign`,
  `add_reply`, `add_note`.

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
