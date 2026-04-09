<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <a href="README.fr.md">Français</a> •
  <a href="README.it.md">Italiano</a> •
  <a href="README.ja.md">日本語</a> •
  <a href="README.ko.md">한국어</a> •
  <b>Nederlands</b> •
  <a href="README.pl.md">Polski</a> •
  <a href="README.pt-BR.md">Português (BR)</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.tr.md">Türkçe</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

Embedded helpdesk module for NestJS applications. Drop-in ticketing, SLA management, knowledge base, and more.

## Functies

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
- **Real-time Broadcasting** -- Socket.IO gateway for live updates (opt-in)
- **Capacity Management** -- Per-agent ticket limits with real-time tracking
- **Skill-based Routing** -- Assign tickets based on agent skills and availability
- **CSAT Ratings** -- Post-resolution satisfaction surveys with token-based submission
- **2FA (TOTP)** -- Two-factor authentication for agents via `otplib`
- **Guest Access** -- Token-based ticket access without authentication

## Vereisten

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Installatie

```bash
npm install @escalated-dev/escalated-nestjs
```

## Installatie

### 1. Import the module

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscalatedModule } from '@escalated-dev/escalated-nestjs';

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
      appName: 'My App',
      appUrl: 'https://myapp.com',
      enableWebsockets: false,
      enableKnowledgeBase: true,
      enableCsat: true,
      enable2fa: false,
    }),
  ],
})
export class AppModule {}
```

### 2. Configuration options

| Option                | Type       | Default       | Description                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | URL prefix for all routes               |
| `enableWebsockets`    | `boolean`  | `false`       | Enable Socket.IO real-time broadcasting |
| `enableKnowledgeBase` | `boolean`  | `true`        | Enable KB articles and categories       |
| `enableCsat`          | `boolean`  | `true`        | Enable satisfaction surveys             |
| `enable2fa`           | `boolean`  | `false`       | Enable TOTP 2FA for agents              |
| `appName`             | `string`   | `'Escalated'` | Branding name for emails                |
| `appUrl`              | `string`   | --            | Base URL for links                      |
| `maxFileSize`         | `number`   | `10485760`    | Max upload size in bytes                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhook retry attempts                  |
| `widgetOrigins`       | `string[]` | `['*']`       | CORS origins for widget                 |
| `adminGuard`          | `class`    | --            | Custom guard for admin routes           |
| `agentGuard`          | `class`    | --            | Custom guard for agent routes           |
| `customerGuard`       | `class`    | --            | Custom guard for customer routes        |
| `userResolver`        | `function` | --            | Extract user from request               |

### 3. Database migration

With `synchronize: true`, TypeORM auto-creates tables. For production, generate migrations:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

All tables are prefixed with `escalated_` to avoid conflicts.

## API Endpoints

### Agent Routes (`/escalated/agent/`)

| Method | Path                                    | Description               |
| ------ | --------------------------------------- | ------------------------- |
| GET    | `/tickets`                              | List tickets with filters |
| POST   | `/tickets`                              | Create ticket             |
| GET    | `/tickets/:id`                          | Show ticket with replies  |
| PUT    | `/tickets/:id`                          | Update ticket             |
| DELETE | `/tickets/:id`                          | Delete ticket             |
| POST   | `/tickets/:id/replies`                  | Add reply                 |
| POST   | `/tickets/:id/merge/:targetId`          | Merge tickets             |
| POST   | `/tickets/:id/split`                    | Split ticket              |
| POST   | `/tickets/:id/snooze`                   | Snooze ticket             |
| GET    | `/tickets/:ticketId/links`              | List ticket links         |
| POST   | `/tickets/:ticketId/links`              | Link tickets              |
| GET    | `/tickets/:ticketId/side-conversations` | List side conversations   |
| POST   | `/tickets/:ticketId/side-conversations` | Create side conversation  |
| GET    | `/macros`                               | List macros               |
| POST   | `/macros/:macroId/execute/:ticketId`    | Execute macro             |
| GET    | `/canned-responses`                     | List canned responses     |
| GET    | `/saved-views`                          | List saved views          |
| POST   | `/saved-views`                          | Create saved view         |

### Admin Routes (`/escalated/admin/`)

| Method  | Path                    | Description               |
| ------- | ----------------------- | ------------------------- |
| GET/PUT | `/settings`             | Manage settings           |
| CRUD    | `/departments`          | Manage departments        |
| CRUD    | `/tags`                 | Manage tags               |
| CRUD    | `/custom-fields`        | Manage custom fields      |
| CRUD    | `/roles`                | Manage roles              |
| CRUD    | `/sla/policies`         | Manage SLA policies       |
| CRUD    | `/sla/escalation-rules` | Manage escalation rules   |
| CRUD    | `/sla/schedules`        | Manage business schedules |
| CRUD    | `/webhooks`             | Manage webhooks           |
| CRUD    | `/api-tokens`           | Manage API tokens         |
| CRUD    | `/agents`               | Manage agent profiles     |
| CRUD    | `/macros`               | Manage macros             |
| CRUD    | `/canned-responses`     | Manage canned responses   |
| CRUD    | `/kb/categories`        | Manage KB categories      |
| CRUD    | `/kb/articles`          | Manage KB articles        |
| POST    | `/import/tickets`       | Bulk import tickets       |
| POST    | `/2fa/generate`         | Generate 2FA secret       |
| POST    | `/2fa/enable`           | Enable 2FA                |
| GET     | `/audit-logs`           | View audit logs           |

### Customer Routes (`/escalated/customer/`)

| Method | Path                   | Description          |
| ------ | ---------------------- | -------------------- |
| GET    | `/tickets`             | List own tickets     |
| POST   | `/tickets`             | Create ticket        |
| GET    | `/tickets/:id`         | View own ticket      |
| POST   | `/tickets/:id/replies` | Reply to own ticket  |
| POST   | `/tickets/:id/rate`    | Submit CSAT rating   |
| GET    | `/kb/categories`       | Browse KB categories |
| GET    | `/kb/articles`         | Browse KB articles   |
| GET    | `/kb/search`           | Search KB            |

### Widget Routes (`/escalated/widget/`)

| Method | Path                   | Description               |
| ------ | ---------------------- | ------------------------- |
| POST   | `/tickets`             | Create ticket (public)    |
| GET    | `/tickets/:id`         | View ticket (guest token) |
| POST   | `/tickets/:id/replies` | Reply (guest token)       |
| GET    | `/kb/search`           | Search KB                 |
| POST   | `/rate/:token`         | Submit CSAT               |

## Using Services Directly

All services are exported and can be injected into your own code:

```typescript
import { Injectable } from '@nestjs/common';
import { TicketService, AgentService } from '@escalated-dev/escalated-nestjs';

@Injectable()
export class MyService {
  constructor(
    private readonly ticketService: TicketService,
    private readonly agentService: AgentService,
  ) {}

  async assignToAvailableAgent(ticketId: number) {
    const agent = await this.agentService.findAvailableAgent();
    if (agent) {
      await this.ticketService.update(ticketId, { assigneeId: agent.userId }, 0);
    }
  }
}
```

## Gebeurtenissen

The module emits events via `@nestjs/event-emitter`:

```typescript
import { OnEvent } from '@nestjs/event-emitter';
import { ESCALATED_EVENTS, TicketCreatedEvent } from '@escalated-dev/escalated-nestjs';

@Injectable()
export class NotificationService {
  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  handleTicketCreated(event: TicketCreatedEvent) {
    // Send notification, update external system, etc.
  }
}
```

Events: `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_ASSIGNED`, `TICKET_STATUS_CHANGED`, `TICKET_REPLY_CREATED`, `TICKET_MERGED`, `TICKET_SPLIT`, `SLA_BREACHED`.

## Real-time Updates

Enable WebSocket broadcasting for live ticket updates:

```typescript
EscalatedModule.forRoot({
  enableWebsockets: true,
});
```

Client-side (Socket.IO):

```javascript
const socket = io('/escalated');
socket.emit('join:ticket', { ticketId: 1 });
socket.on('ticket:updated', (data) => console.log('Updated:', data));
socket.on('ticket:reply', (data) => console.log('New reply:', data));
```

## Development

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## TypeORM Entities

All 32 entities are exported and prefixed with `escalated_`:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Licentie

MIT
