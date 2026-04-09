<p align="center">
  <a href="README.ar.md">العربية</a> •
  <b>Deutsch</b> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <a href="README.fr.md">Français</a> •
  <a href="README.it.md">Italiano</a> •
  <a href="README.ja.md">日本語</a> •
  <a href="README.ko.md">한국어</a> •
  <a href="README.nl.md">Nederlands</a> •
  <a href="README.pl.md">Polski</a> •
  <a href="README.pt-BR.md">Português (BR)</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.tr.md">Türkçe</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

Eingebettetes Helpdesk-Modul für NestJS-Anwendungen. Drop-in-Ticketing, SLA-Management, Wissensdatenbank und mehr.

## Funktionen

- **Ticket Management** -- Vollständige Verwaltung mit Lebenszyklusverfolgung, Prioritäten, Abteilungen, Tags und benutzerdefinierten Feldern
- **SLA Policies** -- Konfigurierbare Antwort-/Lösungsziele mit Geschäftszeiten-Unterstützung
- **Automations** -- Zeitbasierte Verarbeitung über `@nestjs/schedule` (SLA-Prüfungen, Schlummer-Aufwachen, Webhook-Wiederholungen)
- **Escalation Rules** -- Automatische Neuzuweisung und Benachrichtigungen bei SLA-Verletzung
- **Macros & Canned Responses** -- Ein-Klick-Mehrfachaktions-Makros und vorformulierte Antworten
- **Custom Fields** -- Dynamische Felder mit Validierung (Text, Zahl, Auswahl, Checkbox, Datum)
- **Knowledge Base** -- Artikel mit Kategorien, Suche, Aufrufverfolgung und Nützlichkeitsbewertungen
- **Webhooks** -- HMAC-signierte Zustellung mit exponentieller Backoff-Wiederholung
- **API Tokens** -- Bearer-Token-Authentifizierung mit begrenzten Berechtigungen
- **Roles & Permissions** -- Granulares Berechtigungssystem mit NestJS-Guards
- **Audit Logging** -- Interceptor-basierte Aktivitätsverfolgung für alle Änderungen
- **Import System** -- Massenimport für Tickets, Tags und Abteilungen
- **Side Conversations** -- Thread-Diskussionen innerhalb eines Tickets
- **Ticket Merging & Linking** -- Duplikate zusammenführen, verwandte Tickets verknüpfen
- **Ticket Splitting** -- Ein Ticket in separate Vorgänge aufteilen
- **Ticket Snooze** -- Schlummern mit automatischem Aufwecken per Cron
- **Saved Views** -- Persönliche und geteilte gefilterte Ansichten
- **Widget API** -- Öffentliche Endpunkte für einbettbares Support-Widget mit Rate-Limiting
- **Real-time Broadcasting** -- Socket.IO-Gateway für Live-Updates (optional)
- **Capacity Management** -- Pro-Agent-Ticket-Limits mit Echtzeit-Tracking
- **Skill-based Routing** -- Tickets basierend auf Agenten-Fähigkeiten und Verfügbarkeit zuweisen
- **CSAT Ratings** -- Zufriedenheitsumfragen nach Lösung mit tokenbasierter Übermittlung
- **2FA (TOTP)** -- Zwei-Faktor-Authentifizierung für Agenten über `otplib`
- **Guest Access** -- Tokenbasierter Ticketzugriff ohne Authentifizierung

## Voraussetzungen

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Installation

```bash
npm install @escalated-dev/escalated-nestjs
```

## Einrichtung

### 1. Modul importieren

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

### 2. Konfigurationsoptionen

| Option                | Type       | Default       | Beschreibung                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | URL-Präfix für alle Routen               |
| `enableWebsockets`    | `boolean`  | `false`       | Socket.IO-Echtzeit-Broadcasting aktivieren |
| `enableKnowledgeBase` | `boolean`  | `true`        | KB-Artikel und -Kategorien aktivieren       |
| `enableCsat`          | `boolean`  | `true`        | Zufriedenheitsumfragen aktivieren             |
| `enable2fa`           | `boolean`  | `false`       | TOTP-2FA für Agenten aktivieren              |
| `appName`             | `string`   | `'Escalated'` | Branding-Name für E-Mails                |
| `appUrl`              | `string`   | --            | Basis-URL für Links                      |
| `maxFileSize`         | `number`   | `10485760`    | Max. Upload-Größe in Bytes                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhook-Wiederholungsversuche                  |
| `widgetOrigins`       | `string[]` | `['*']`       | CORS-Ursprünge für Widget                 |
| `adminGuard`          | `class`    | --            | Benutzerdefinierter Guard für Admin-Routen           |
| `agentGuard`          | `class`    | --            | Benutzerdefinierter Guard für Agenten-Routen           |
| `customerGuard`       | `class`    | --            | Benutzerdefinierter Guard für Kunden-Routen        |
| `userResolver`        | `function` | --            | Benutzer aus Anfrage extrahieren               |

### 3. Datenbankmigration

Mit `synchronize: true` erstellt TypeORM automatisch Tabellen. Für die Produktion generieren Sie Migrationen:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Alle Tabellen sind mit `escalated_` präfixiert, um Konflikte zu vermeiden.

## API-Endpunkte

### Agent Routes (`/escalated/agent/`)

| Methode | Pfad | Beschreibung |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Tickets mit Filtern auflisten |
| POST | `/tickets` | Ticket erstellen |
| GET | `/tickets/:id` | Ticket mit Antworten anzeigen |
| PUT | `/tickets/:id` | Ticket aktualisieren |
| DELETE | `/tickets/:id` | Ticket löschen |
| POST | `/tickets/:id/replies` | Antwort hinzufügen |
| POST | `/tickets/:id/merge/:targetId` | Tickets zusammenführen |
| POST | `/tickets/:id/split` | Ticket aufteilen |
| POST | `/tickets/:id/snooze` | Ticket schlummern |
| GET | `/tickets/:ticketId/links` | Ticket-Links auflisten |
| POST | `/tickets/:ticketId/links` | Tickets verknüpfen |
| GET | `/tickets/:ticketId/side-conversations` | Nebenkonversationen auflisten |
| POST | `/tickets/:ticketId/side-conversations` | Nebenkonversation erstellen |
| GET | `/macros` | Makros auflisten |
| POST | `/macros/:macroId/execute/:ticketId` | Makro ausführen |
| GET | `/canned-responses` | Vorgefertigte Antworten auflisten |
| GET | `/saved-views` | Gespeicherte Ansichten auflisten |
| POST | `/saved-views` | Gespeicherte Ansicht erstellen |

### Admin Routes (`/escalated/admin/`)

| Methode | Pfad | Beschreibung |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Einstellungen verwalten |
| CRUD | `/departments` | Abteilungen verwalten |
| CRUD | `/tags` | Tags verwalten |
| CRUD | `/custom-fields` | Benutzerdefinierte Felder verwalten |
| CRUD | `/roles` | Rollen verwalten |
| CRUD | `/sla/policies` | SLA-Richtlinien verwalten |
| CRUD | `/sla/escalation-rules` | Eskalationsregeln verwalten |
| CRUD | `/sla/schedules` | Geschäftszeitpläne verwalten |
| CRUD | `/webhooks` | Webhooks verwalten |
| CRUD | `/api-tokens` | API-Tokens verwalten |
| CRUD | `/agents` | Agentenprofile verwalten |
| CRUD | `/macros` | Makros verwalten |
| CRUD | `/canned-responses` | Vorgefertigte Antworten verwalten |
| CRUD | `/kb/categories` | KB-Kategorien verwalten |
| CRUD | `/kb/articles` | KB-Artikel verwalten |
| POST | `/import/tickets` | Tickets massenhaft importieren |
| POST | `/2fa/generate` | 2FA-Geheimnis generieren |
| POST | `/2fa/enable` | 2FA aktivieren |
| GET | `/audit-logs` | Audit-Logs anzeigen |

### Customer Routes (`/escalated/customer/`)

| Methode | Pfad | Beschreibung |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Eigene Tickets auflisten |
| POST | `/tickets` | Ticket erstellen |
| GET | `/tickets/:id` | Eigenes Ticket anzeigen |
| POST | `/tickets/:id/replies` | Auf eigenes Ticket antworten |
| POST | `/tickets/:id/rate` | CSAT-Bewertung abgeben |
| GET | `/kb/categories` | KB-Kategorien durchsuchen |
| GET | `/kb/articles` | KB-Artikel durchsuchen |
| GET | `/kb/search` | KB durchsuchen |

### Widget Routes (`/escalated/widget/`)

| Methode | Pfad | Beschreibung |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Ticket erstellen (öffentlich) |
| GET | `/tickets/:id` | Ticket anzeigen (Gast-Token) |
| POST | `/tickets/:id/replies` | Antworten (Gast-Token) |
| GET | `/kb/search` | KB durchsuchen |
| POST | `/rate/:token` | CSAT abgeben |

## Services direkt verwenden

Alle Services sind exportiert und können in Ihren eigenen Code injiziert werden:

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

## Ereignisse

Das Modul emittiert Ereignisse über `@nestjs/event-emitter`:

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

## Echtzeit-Updates

WebSocket-Broadcasting für Live-Ticket-Updates aktivieren:

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

## Entwicklung

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## TypeORM-Entitäten

Alle 32 Entitäten sind exportiert und mit `escalated_` präfixiert:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Lizenz

MIT
