# Changelog

All notable changes to `@escalated-dev/escalated-nestjs` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
