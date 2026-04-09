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

Ingebouwde helpdeskmodule voor NestJS-applicaties. Drop-in ticketing, SLA-beheer, kennisbank en meer.

## Functies

- **Ticket Management** -- Volledig beheer met levenscyclustracking, prioriteiten, afdelingen, tags en aangepaste velden
- **SLA Policies** -- Configureerbare respons-/oplossingsdoelen met ondersteuning voor kantooruren
- **Automations** -- Tijdgebaseerde verwerking via `@nestjs/schedule` (SLA-controles, snooze-wekken, webhook-herhalingen)
- **Escalation Rules** -- Automatische hertoewijzing en notificaties bij SLA-schending
- **Macros & Canned Responses** -- Eén-klik multi-actie macro's en sjabloonantwoorden
- **Custom Fields** -- Dynamische velden met validatie (tekst, nummer, selectie, checkbox, datum)
- **Knowledge Base** -- Artikelen met categorieën, zoeken, weergavetracking en nuttigheidsbeoordelingen
- **Webhooks** -- HMAC-ondertekende bezorging met exponentiële backoff-herhaling
- **API Tokens** -- Bearer-tokenauthenticatie met beperkte bevoegdheden
- **Roles & Permissions** -- Gedetailleerd permissiesysteem met NestJS-guards
- **Audit Logging** -- Interceptor-gebaseerde activiteitstracking voor alle mutaties
- **Import System** -- Bulk import voor tickets, tags en afdelingen
- **Side Conversations** -- Threaded discussies binnen een ticket
- **Ticket Merging & Linking** -- Duplicaten samenvoegen, gerelateerde tickets koppelen
- **Ticket Splitting** -- Een ticket opsplitsen in afzonderlijke problemen
- **Ticket Snooze** -- Snoozen met automatisch wekken via cron
- **Saved Views** -- Persoonlijke en gedeelde gefilterde weergaven
- **Widget API** -- Openbare endpoints voor inbedbaar supportwidget met snelheidsbeperking
- **Real-time Broadcasting** -- Socket.IO-gateway voor live updates (opt-in)
- **Capacity Management** -- Ticketlimieten per agent met real-time tracking
- **Skill-based Routing** -- Tickets toewijzen op basis van agentvaardigheden en beschikbaarheid
- **CSAT Ratings** -- Tevredenheidsonderzoeken na oplossing met tokengebaseerde indiening
- **2FA (TOTP)** -- Tweefactorauthenticatie voor agenten via `otplib`
- **Guest Access** -- Tokengebaseerde tickettoegang zonder authenticatie

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

### 1. Module importeren

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

### 2. Configuratieopties

| Option                | Type       | Default       | Beschrijving                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | URL-voorvoegsel voor alle routes               |
| `enableWebsockets`    | `boolean`  | `false`       | Socket.IO real-time broadcasting inschakelen |
| `enableKnowledgeBase` | `boolean`  | `true`        | KB-artikelen en -categorieën inschakelen       |
| `enableCsat`          | `boolean`  | `true`        | Tevredenheidsonderzoeken inschakelen             |
| `enable2fa`           | `boolean`  | `false`       | TOTP 2FA voor agenten inschakelen              |
| `appName`             | `string`   | `'Escalated'` | Merknaam voor e-mails                |
| `appUrl`              | `string`   | --            | Basis-URL voor links                      |
| `maxFileSize`         | `number`   | `10485760`    | Max. uploadgrootte in bytes                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhook-herhalingspogingen                  |
| `widgetOrigins`       | `string[]` | `['*']`       | CORS-oorsprongen voor widget                 |
| `adminGuard`          | `class`    | --            | Aangepaste guard voor admin-routes           |
| `agentGuard`          | `class`    | --            | Aangepaste guard voor agent-routes           |
| `customerGuard`       | `class`    | --            | Aangepaste guard voor klant-routes        |
| `userResolver`        | `function` | --            | Gebruiker uit verzoek extraheren               |

### 3. Databasemigratie

Met `synchronize: true` maakt TypeORM automatisch tabellen aan. Voor productie genereert u migraties:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Alle tabellen hebben het voorvoegsel `escalated_` om conflicten te voorkomen.

## API-endpoints

### Agent Routes (`/escalated/agent/`)

| Methode | Pad | Beschrijving |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Tickets met filters weergeven |
| POST | `/tickets` | Ticket aanmaken |
| GET | `/tickets/:id` | Ticket met antwoorden tonen |
| PUT | `/tickets/:id` | Ticket bijwerken |
| DELETE | `/tickets/:id` | Ticket verwijderen |
| POST | `/tickets/:id/replies` | Antwoord toevoegen |
| POST | `/tickets/:id/merge/:targetId` | Tickets samenvoegen |
| POST | `/tickets/:id/split` | Ticket opsplitsen |
| POST | `/tickets/:id/snooze` | Ticket snoozen |
| GET | `/tickets/:ticketId/links` | Ticketlinks weergeven |
| POST | `/tickets/:ticketId/links` | Tickets koppelen |
| GET | `/tickets/:ticketId/side-conversations` | Zijgesprekken weergeven |
| POST | `/tickets/:ticketId/side-conversations` | Zijgesprek aanmaken |
| GET | `/macros` | Macro's weergeven |
| POST | `/macros/:macroId/execute/:ticketId` | Macro uitvoeren |
| GET | `/canned-responses` | Standaardantwoorden weergeven |
| GET | `/saved-views` | Opgeslagen weergaven tonen |
| POST | `/saved-views` | Opgeslagen weergave aanmaken |

### Admin Routes (`/escalated/admin/`)

| Methode | Pad | Beschrijving |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Instellingen beheren |
| CRUD | `/departments` | Afdelingen beheren |
| CRUD | `/tags` | Tags beheren |
| CRUD | `/custom-fields` | Aangepaste velden beheren |
| CRUD | `/roles` | Rollen beheren |
| CRUD | `/sla/policies` | SLA-beleid beheren |
| CRUD | `/sla/escalation-rules` | Escalatieregels beheren |
| CRUD | `/sla/schedules` | Bedrijfsroosters beheren |
| CRUD | `/webhooks` | Webhooks beheren |
| CRUD | `/api-tokens` | API-tokens beheren |
| CRUD | `/agents` | Agentprofielen beheren |
| CRUD | `/macros` | Macro's beheren |
| CRUD | `/canned-responses` | Standaardantwoorden beheren |
| CRUD | `/kb/categories` | KB-categorieën beheren |
| CRUD | `/kb/articles` | KB-artikelen beheren |
| POST | `/import/tickets` | Tickets massaal importeren |
| POST | `/2fa/generate` | 2FA-geheim genereren |
| POST | `/2fa/enable` | 2FA activeren |
| GET | `/audit-logs` | Auditlogs bekijken |

### Customer Routes (`/escalated/customer/`)

| Methode | Pad | Beschrijving |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Eigen tickets weergeven |
| POST | `/tickets` | Ticket aanmaken |
| GET | `/tickets/:id` | Eigen ticket bekijken |
| POST | `/tickets/:id/replies` | Op eigen ticket antwoorden |
| POST | `/tickets/:id/rate` | CSAT-beoordeling indienen |
| GET | `/kb/categories` | KB-categorieën bladeren |
| GET | `/kb/articles` | KB-artikelen bladeren |
| GET | `/kb/search` | KB doorzoeken |

### Widget Routes (`/escalated/widget/`)

| Methode | Pad | Beschrijving |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Ticket aanmaken (openbaar) |
| GET | `/tickets/:id` | Ticket bekijken (gasttoken) |
| POST | `/tickets/:id/replies` | Antwoorden (gasttoken) |
| GET | `/kb/search` | KB doorzoeken |
| POST | `/rate/:token` | CSAT indienen |

## Services direct gebruiken

Alle services zijn geëxporteerd en kunnen worden geïnjecteerd in uw eigen code:

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

De module zendt gebeurtenissen uit via `@nestjs/event-emitter`:

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

## Realtime updates

WebSocket-broadcasting inschakelen voor live ticketupdates:

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

## Ontwikkeling

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## TypeORM-entiteiten

Alle 32 entiteiten zijn geëxporteerd en voorzien van het voorvoegsel `escalated_`:

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
