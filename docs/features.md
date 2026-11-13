# Features

## Features

- **Ticket Management** -- Full CRUD with lifecycle tracking, priorities, departments, tags, and custom fields
- **SLA Policies** -- Configurable response/resolution targets with business hours support
- **Automations** -- Time-based processing via `@nestjs/schedule` (SLA checks, snooze wake-up, webhook retries)
- **Escalation Rules** -- Automatic reassignment and notifications on SLA breach
- **Macros & Canned Responses** -- One-click multi-action macros and templated replies
- **Custom Fields** -- Dynamic fields with validation (text, number, select, checkbox, date)
- **Knowledge Base** -- Articles with categories, search, view tracking, and helpfulness ratings
- **Webhooks** -- HMAC-signed delivery with exponential backoff retry
- **API Tokens** -- Bearer token authentication with scoped abilities
- **Roles & Permissions** -- Granular permission system with NestJS guards
- **Audit Logging** -- Interceptor-based activity tracking for all mutations
- **Import System** -- Bulk import for tickets, tags, and departments
- **Side Conversations** -- Threaded discussions within a ticket
- **Ticket Merging & Linking** -- Merge duplicates, link related tickets
- **Ticket Splitting** -- Break a ticket into separate issues
- **Ticket Snooze** -- Snooze with automatic wake-up via cron
- **Saved Views** -- Personal and shared filtered views
- **Widget API** -- Public endpoints for embeddable support widget with rate limiting
- **Public Ticket System** -- Unauthenticated submission via widget form or inbound email, Contact-based identity with email dedupe, configurable guest policy, signed Reply-To for threaded email conversations
- **Workflow Engine** -- Admin-configured rules fire on ticket/reply events (conditions + actions: assign, tag, set priority/status/department, insert canned reply, etc.); evaluation logs per execution
- **Access control** -- Roles & permissions, two-factor authentication and single sign-on (SAML, OAuth 2 / OIDC, JWT) as install-level switches (`access.rolesPermissions`, `access.twoFactor`, `access.sso`), enforced on every admin and agent route when on and hidden when off (see [docs/access-control.md](access-control.md))
- **Plugins** -- `@escalated-dev/plugin-sdk` plugins registered in the module run in-process, with Admin > Plugins, plugin pages, endpoints and webhooks (see [docs/plugins.md](plugins.md))
- **Real-time Broadcasting** -- Socket.IO gateway for live updates (opt-in)
- **Capacity Management** -- Per-agent ticket limits with real-time tracking
- **Skill-based Routing** -- Assign tickets based on agent skills and availability
- **CSAT Ratings** -- Post-resolution satisfaction surveys with token-based submission
- **2FA (TOTP)** -- Two-factor authentication for agents via `otplib`
- **Guest Access** -- Token-based ticket access without authentication
- **Internationalization** -- Translations sourced from the central [`@escalated-dev/locale`](https://github.com/escalated-dev/escalated-locale) package via `nestjs-i18n`, with a chained overlay loader for plugin-local and host-app overrides (see `src/i18n/overrides/README.md`)
