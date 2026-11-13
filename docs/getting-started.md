# Getting started

## Requirements

- Node.js 22+ for the current dependency graph
- NestJS 11
- TypeORM 0.3.x (the published peer range)
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

The manifest's broader Node 20 and Nest 10 compatibility declarations are under
review. See the [dependency audit](dependency-audit.md) for the existing
engine mismatch, installed-host checks and held major upgrades.

## Installation

```bash
npm install @escalated-dev/escalated-nestjs
```

## Setup

### 1. Import the module

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscalatedModule } from '@escalated-dev/escalated-nestjs';
import { AdminGuard, AgentGuard, CustomerGuard } from './auth'; // your own guards

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      username: 'user',
      password: 'pass',
      autoLoadEntities: true,
      synchronize: true, // disable in production
    }),
    EscalatedModule.forRoot({
      routePrefix: 'escalated',
      // Required: admin, agent and customer routes refuse every request without them.
      adminGuard: AdminGuard,
      agentGuard: AgentGuard,
      customerGuard: CustomerGuard,
      appName: 'My App',
      appUrl: 'https://myapp.com',
      enableWebsockets: false,
      enableKnowledgeBase: true,
      enableCsat: true,
    }),
  ],
})
export class AppModule {}
```

### 2. Configuration options

| Option                | Type       | Default       | Description                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | URL prefix for all routes               |
| `connection`          | `string`   | --            | Named TypeORM DataSource for Escalated's tables (default DataSource when unset) |
| `enableWebsockets`    | `boolean`  | `false`       | Enable Socket.IO real-time broadcasting |
| `enableKnowledgeBase` | `boolean`  | `true`        | Enable KB articles and categories       |
| `enableCsat`          | `boolean`  | `true`        | Enable satisfaction surveys             |
| `enable2fa`           | `boolean`  | `false`       | Deprecated and unused; two-factor is `access.twoFactor` |
| `appName`             | `string`   | `'Escalated'` | Branding name for emails                |
| `appUrl`              | `string`   | --            | Base URL for links                      |
| `debug`               | `boolean`  | `false`       | A 500 on an Inertia visit to a screen reaches your filters and Nest's handling instead of the generic Error page (see [docs/ui.md](ui.md#errors)). Development only |

### Database connection

By default Escalated's entities register against your default TypeORM
DataSource. Name a different one to keep the support tables somewhere else — a
schema shared with a legacy system, a separate reporting store, or simply out
of your primary database:

```ts
TypeOrmModule.forRoot({ name: 'support', /* ... */ }),

EscalatedModule.forRoot({
  connection: 'support',
});
```

The name is whatever you passed to `TypeOrmModule.forRoot({ name })`.

Every service in the package injects its repository with a plain
`@InjectRepository(X)`, which binds the default DataSource's token where the
decorator is written — long before your connection name is known. Escalated
registers its entities against the named DataSource and aliases those default
tokens onto it, so the whole package follows your choice with no change to how
you consume it.

**Your user entity does not move.** It belongs to your application, and
Escalated stores host user ids as plain unconstrained columns precisely so the
two can live on different connections — there is no foreign key that would have
to span them.
| `maxFileSize`         | `number`   | `10485760`    | Max upload size in bytes                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhook retry attempts                  |
| `access`              | `object`   | all off       | Install-level access switches: `rolesPermissions`, `twoFactor`, `sso` (env `ESCALATED_ROLES_PERMISSIONS`, `ESCALATED_TWO_FACTOR`, `ESCALATED_SSO`) (see [docs/access-control.md](access-control.md)) |
| `guestAccess`         | `object`   | --            | Verified guest access: `secret`, `ttlMinutes`, code budgets, `legacyTokens`, `sendCode` (see [docs/guest-access.md](guest-access.md)) |
| `slaWarningMinutes`   | `number`   | `30`          | Minutes before an SLA deadline that `sla.warning` fires (`0` = off) |
| `widgetOrigins`       | `string[]` | `[]`          | Sites that may embed the widget (see [Embedding the widget](embedding-the-widget.md)) |
| `adminGuard`          | `class`    | --            | Guard for `/escalated/admin/*`. Unset refuses every admin route (see Route guards) |
| `agentGuard`          | `class`    | --            | Guard for `/escalated/agent/*`. Unset refuses every agent route |
| `customerGuard`       | `class`    | --            | Guard for `/escalated/customer/tickets/*`. Unset refuses every customer ticket route |
| `userResolver`        | `function` | --            | Extract user from request               |
| `userEntity`          | `class \| string` | --      | Your user entity (or table); SSO finds users in it by email when `sso.findUserByEmail` is unset |
| `session`             | `object \| false` | --      | Escalated's own session for its routes when the host mounts none (two-factor and SSO; needs `express-session`) |
| `mail`                | `object`   | --            | Outbound email config (see below)       |
| `inbound`             | `object`   | --            | Inbound email config (see below)        |
| `guestPolicy`         | `object`   | unassigned    | Guest identity policy (see below)       |
| `ticketActions`       | `object`   | `{actions:[]}`| Custom agent ticket actions (see below) |
| `ticketSubjects`      | `object`   | `{types:[]}`  | Host entities a ticket is about (see below) |

#### Route guards (`adminGuard`, `agentGuard`, `customerGuard`)

Escalated owns no users or sessions, so your app decides who is an admin, an agent or a customer. Give each route group a guard:

| Option                                   | Routes it protects              |
| ---------------------------------------- | ------------------------------- |
| `adminGuard`                             | `/escalated/admin/*`            |
| `agentGuard`                             | `/escalated/agent/*`            |
| `customerGuard`                          | `/escalated/customer/tickets/*` |
| either `agentGuard` or `customerGuard`   | `/escalated/attachments/*`      |

**Route groups fail closed.** When a group's guard is not configured, every request to that group is refused with `403` and a warning is logged once. The routes are never open by default.

A guard is any NestJS `CanActivate`, given as a class or an instance. If you also register the class as a provider in your own module, Escalated uses that instance, so the guard can inject your services. Otherwise Escalated creates it with dependency injection inside its own module. An exception thrown by the guard (for example `UnauthorizedException`) is sent as the response; a guard that returns `false` produces `403`.

Controllers read the acting user from `req.user.id`, so authenticate the request and set `req.user` in the guard, or in middleware that runs before it.

```typescript
@Injectable()
export class SupportAdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = await this.auth.userFromRequest(req); // your authentication
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return user.isAdmin;
  }
}

@Module({
  imports: [
    EscalatedModule.forRoot({
      adminGuard: SupportAdminGuard,
      agentGuard: SupportAgentGuard,
      customerGuard: SupportCustomerGuard,
    }),
  ],
  providers: [AuthService, SupportAdminGuard, SupportAgentGuard, SupportCustomerGuard],
})
export class AppModule {}
```

None of the three guards apply to these routes, which are public or carry their own authentication:

- `/escalated/widget/*`, including widget chat, and `/escalated/guest/*` (public; guests prove their email with a code and read their ticket with an expiring grant, see [Verified guest access](guest-access.md))
- `/escalated/customer/kb/*` (published knowledge base articles)
- `/escalated/webhook/email/*` (`X-Escalated-Inbound-Secret`, see below)
- `/escalated/api/v1/auth/*` (your `apiAuth` callbacks)
- `/escalated/api/v1/mobile/guest/*` (the mobile guest API: email codes and expiring grants, see [Verified guest access](guest-access.md#mobile-guest-api))
- `/escalated/n/*` and `/escalated/webhooks/newsletter/*` (newsletter tracking, unsubscribe and ESP webhooks)

The newsletter admin routes (`/admin/newsletters/*`) check the `newsletters.manage` and `newsletters.send` permissions on every request.

#### Outbound email (`mail`)

```typescript
EscalatedModule.forRoot({
  mail: {
    from: 'support@example.com',
    transport: {
      host: 'smtp.example.com',
      port: 587,
      auth: { user: 'x', pass: 'y' },
    },
  },
});
```

When `mail` is absent, the `MailerModule` is not registered and `EmailService` silently no-ops — modules boot cleanly without a transport.

#### Inbound email (`inbound`)

```typescript
EscalatedModule.forRoot({
  inbound: {
    replyDomain: 'reply.example.com',   // domain in our Message-ID + Reply-To
    replySecret: '32-byte-hex-secret',  // HMAC key for signed reply-to
    webhookSecret: 'shared-secret',     // X-Escalated-Inbound-Secret header value
    provider: 'postmark',               // parser adapter
  },
});
```

Webhook endpoint: `POST /escalated/webhook/email/inbound`. Guard requires `X-Escalated-Inbound-Secret` header to match `webhookSecret` (constant-time compare).

How an inbound email is routed:

- **Finding the ticket.** With `replySecret` set (outbound mail then carries `reply+{id}.{hmac8}@replyDomain` as its Reply-To), only that signed address identifies a ticket. Without a secret, the `In-Reply-To` / `References` headers and a `[TK-XXX]` subject reference are used instead.
- **Sender check.** A matched email becomes a reply only when the `From` address (case-insensitive) is the ticket's requester: the ticket's Contact, or a Contact linked to the requester user. The reply is posted as that requester. Identity is never taken from `From`, so an email naming an agent's address is not posted as that agent; agents reply in the app.
- **Everything else** (no match, or a sender who is not the requester) creates a new ticket for the sender, so mail is never dropped and the matched ticket is left untouched.

`From` can still be forged for the requester's own address, so also have your inbound provider enforce SPF/DKIM/DMARC.

#### Guest policy (`guestPolicy`)

Controls the identity assigned to a ticket submitted via the public form or inbound email.

```typescript
// Default: no host-app user, contact carries identity
{ mode: 'unassigned' }

// Assign all guest tickets to a shared "guest" user in the host app
{ mode: 'guest_user', guestUserId: 42 }

// Ticket stays unassigned until the guest accepts a signup invite
{ mode: 'prompt_signup', signupUrlTemplate: 'https://app.example.com/signup?token={token}' }
```

Admins can override at runtime via `PUT /escalated/admin/settings`:
```json
{ "key": "guest_policy", "type": "json", "value": { "mode": "guest_user", "guestUserId": 99 } }
```

#### Host user key type (UUID / string users)

Escalated stores references to your host app's users (ticket requester,
assignee, reply author, etc.). By default those columns are integers, matching
a classic auto-incrementing user primary key. If your host app's user table
uses a **UUID or other string primary key**, set `ESCALATED_USER_KEY_TYPE`
before the app bootstraps so the TypeORM entity columns are created as
`varchar(255)` instead of `int`:

```bash
# .env — one of: int (default) | bigint | uuid | string
ESCALATED_USER_KEY_TYPE=uuid
```

This is read from the environment (not the module options) because TypeORM
column decorators are evaluated at class-load time, before
`EscalatedModule.forRoot()` runs. Existing integer-keyed installs need no
change — the default (`int`) produces exactly the same schema as before.
`uuid` and `string` both map to a portable `varchar(255)` that can hold a UUID
or a stringified integer id. All Escalated APIs accept a host user id as either
a `number` or a `string` (`UserId`).

### 3. Database migration

With `synchronize: true`, TypeORM auto-creates tables. For production, generate migrations:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

All tables are prefixed with `escalated_` to avoid conflicts.

## Embedding the admin in your own admin panel (optional)

Escalated's admin is a standalone panel at `/escalated/admin` by default, and
needs no setup. If your app already has an admin panel, you can show
Escalated's admin screens inside it instead: under your prefix, your guards
and middleware, your Vue layout or server-rendered template, or in an iframe
for another origin. It is off unless you configure it (it needs the screens,
`ui.enabled`):

```typescript
import { EscalatedModule, embedAdmin } from '@escalated-dev/escalated-nestjs';

EscalatedModule.forRoot({
  adminGuard: AdminGuard, // Escalated's admin gate stays on the embedded admin
  ui: {
    enabled: true,
    embed: embedAdmin({ prefix: 'admin/support', guards: [BackOfficeGuard], layout: 'Layouts/AdminLayout' }),
  },
});
```

The admin routes then answer under `/admin/support` (the old
`/escalated/admin` URLs 404; route names are unchanged), pages carry an
`escalated.embed` flag, and the admin menu is shared as `escalated.navigation`
for your sidebar. See [docs/embedding-admin.md](embedding-admin.md) for
the three setups (Vue + Inertia layout, server-rendered root view, iframe),
every option and the security notes.

## Screens (Inertia UI)

The shared Vue 3 + Inertia screens for agents, customers and admins are served
when you set `ui: { enabled: true }`. They are off by default, which keeps the
package API-only (escalated-laravel defaults to on; this default will flip in a
future minor). See [docs/ui.md](ui.md).
