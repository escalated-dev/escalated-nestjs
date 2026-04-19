# Changelog

All notable changes to `@escalated-dev/escalated-nestjs` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-18

Initial tagged release.

### Added

- Full NestJS module: TypeORM entities for `Ticket`, `Reply`, `Department`, `Tag`, `SlaPolicy`, `AgentProfile`, `EscalationRule`, `CannedResponse`, `Macro`, `ChatSession`, `Workflow`, etc.; controllers under Customer / Agent / Admin / Widget; guards for API tokens, permissions, knowledge base; mailers; broadcasting; saved views; SLA engine; chat routing.
- Docker dev/demo environment scaffold under `docker/` (excluded from the npm `files`). 3-container Postgres compose stack + minimal NestJS host that imports the package via `npm pack` tarball, registers TypeORM + EscalatedModule, and exposes a `/demo` click-to-login picker. (#14, draft)

### Fixed

- **Postgres compatibility for entity columns** ([#15](https://github.com/escalated-dev/escalated-nestjs/pull/15), fixes [#13](https://github.com/escalated-dev/escalated-nestjs/issues/13)) — 7 entities used `@Column({ type: 'datetime' })`, a MySQL-only TypeORM column type. On Postgres, `DataSource.initialize()` crashed with `DataTypeNotSupportedError: Data type "datetime" ... is not supported by "postgres"`. Switched to `type: 'timestamp'`, which TypeORM maps to `timestamp without time zone` on Postgres, `TIMESTAMP` on MySQL/MariaDB (no migration needed — same underlying type), and ISO8601 TEXT on SQLite.
- **Test specs drifted from service signatures** ([#16](https://github.com/escalated-dev/escalated-nestjs/pull/16)) — `ticket.service.spec.ts` was missing the `TicketLinkRepository` provider that `TicketService`'s constructor added; `agent-ticket.controller.spec.ts` mocked an outdated `TicketService` interface. Added missing repo provider + mock methods, swapped `toEqual(mockTicket)` to `toMatchObject` so test passes despite the controller now enriching the ticket payload. CI on `main` was previously red since #12.
