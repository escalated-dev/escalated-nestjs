<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <a href="README.fr.md">Français</a> •
  <b>Italiano</b> •
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

Modulo helpdesk integrato per applicazioni NestJS. Ticketing drop-in, gestione SLA, base di conoscenza e altro.

## Funzionalità

- **Ticket Management** -- Gestione completa con tracciamento del ciclo di vita, priorità, dipartimenti, tag e campi personalizzati
- **SLA Policies** -- Obiettivi di risposta/risoluzione configurabili con supporto orari lavorativi
- **Automations** -- Elaborazione temporale tramite `@nestjs/schedule` (controlli SLA, risveglio posticipo, ripetizioni webhook)
- **Escalation Rules** -- Riassegnazione automatica e notifiche in caso di violazione SLA
- **Macros & Canned Responses** -- Macro multi-azione con un clic e risposte modello
- **Custom Fields** -- Campi dinamici con validazione (testo, numero, selezione, checkbox, data)
- **Knowledge Base** -- Articoli con categorie, ricerca, tracciamento visualizzazioni e valutazioni di utilità
- **Webhooks** -- Consegna firmata HMAC con ripetizione a backoff esponenziale
- **API Tokens** -- Autenticazione con token Bearer con capacità delimitate
- **Roles & Permissions** -- Sistema di permessi granulare con guard NestJS
- **Audit Logging** -- Tracciamento attività basato su interceptor per tutte le mutazioni
- **Import System** -- Importazione massiva di ticket, tag e dipartimenti
- **Side Conversations** -- Discussioni con thread all'interno di un ticket
- **Ticket Merging & Linking** -- Unire duplicati, collegare ticket correlati
- **Ticket Splitting** -- Dividere un ticket in problemi separati
- **Ticket Snooze** -- Posticipo con risveglio automatico tramite cron
- **Saved Views** -- Viste filtrate personali e condivise
- **Widget API** -- Endpoint pubblici per widget di supporto integrabile con limitazione del rate
- **Real-time Broadcasting** -- Gateway Socket.IO per aggiornamenti in tempo reale (opzionale)
- **Capacity Management** -- Limiti ticket per agente con tracciamento in tempo reale
- **Skill-based Routing** -- Assegnare ticket in base a competenze e disponibilità degli agenti
- **CSAT Ratings** -- Sondaggi di soddisfazione post-risoluzione con invio basato su token
- **2FA (TOTP)** -- Autenticazione a due fattori per agenti tramite `otplib`
- **Guest Access** -- Accesso ai ticket basato su token senza autenticazione

## Requisiti

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Installazione

```bash
npm install @escalated-dev/escalated-nestjs
```

## Configurazione

### 1. Importare il modulo

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

### 2. Opzioni di configurazione

| Option                | Type       | Default       | Descrizione                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | Prefisso URL per tutte le rotte               |
| `enableWebsockets`    | `boolean`  | `false`       | Abilitare broadcasting Socket.IO in tempo reale |
| `enableKnowledgeBase` | `boolean`  | `true`        | Abilitare articoli e categorie KB       |
| `enableCsat`          | `boolean`  | `true`        | Abilitare sondaggi di soddisfazione             |
| `enable2fa`           | `boolean`  | `false`       | Abilitare TOTP 2FA per agenti              |
| `appName`             | `string`   | `'Escalated'` | Nome del brand per le email                |
| `appUrl`              | `string`   | --            | URL base per i link                      |
| `maxFileSize`         | `number`   | `10485760`    | Dimensione max upload in byte                |
| `webhookMaxRetries`   | `number`   | `3`           | Tentativi di ripetizione webhook                  |
| `widgetOrigins`       | `string[]` | `['*']`       | Origini CORS per il widget                 |
| `adminGuard`          | `class`    | --            | Guard personalizzato per rotte admin           |
| `agentGuard`          | `class`    | --            | Guard personalizzato per rotte agente           |
| `customerGuard`       | `class`    | --            | Guard personalizzato per rotte cliente        |
| `userResolver`        | `function` | --            | Estrarre utente dalla richiesta               |

### 3. Migrazione del database

Con `synchronize: true`, TypeORM crea automaticamente le tabelle. Per la produzione, generare le migrazioni:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Tutte le tabelle hanno il prefisso `escalated_` per evitare conflitti.

## Endpoint API

### Agent Routes (`/escalated/agent/`)

| Metodo | Percorso | Descrizione |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Elenco ticket con filtri |
| POST | `/tickets` | Crea ticket |
| GET | `/tickets/:id` | Mostra ticket con risposte |
| PUT | `/tickets/:id` | Aggiorna ticket |
| DELETE | `/tickets/:id` | Elimina ticket |
| POST | `/tickets/:id/replies` | Aggiungi risposta |
| POST | `/tickets/:id/merge/:targetId` | Unisci ticket |
| POST | `/tickets/:id/split` | Dividi ticket |
| POST | `/tickets/:id/snooze` | Posticipa ticket |
| GET | `/tickets/:ticketId/links` | Elenco link ticket |
| POST | `/tickets/:ticketId/links` | Collega ticket |
| GET | `/tickets/:ticketId/side-conversations` | Elenco conversazioni laterali |
| POST | `/tickets/:ticketId/side-conversations` | Crea conversazione laterale |
| GET | `/macros` | Elenco macro |
| POST | `/macros/:macroId/execute/:ticketId` | Esegui macro |
| GET | `/canned-responses` | Elenco risposte predefinite |
| GET | `/saved-views` | Elenco viste salvate |
| POST | `/saved-views` | Crea vista salvata |

### Admin Routes (`/escalated/admin/`)

| Metodo | Percorso | Descrizione |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Gestisci impostazioni |
| CRUD | `/departments` | Gestisci dipartimenti |
| CRUD | `/tags` | Gestisci tag |
| CRUD | `/custom-fields` | Gestisci campi personalizzati |
| CRUD | `/roles` | Gestisci ruoli |
| CRUD | `/sla/policies` | Gestisci politiche SLA |
| CRUD | `/sla/escalation-rules` | Gestisci regole di escalation |
| CRUD | `/sla/schedules` | Gestisci pianificazioni aziendali |
| CRUD | `/webhooks` | Gestisci webhook |
| CRUD | `/api-tokens` | Gestisci token API |
| CRUD | `/agents` | Gestisci profili agente |
| CRUD | `/macros` | Gestisci macro |
| CRUD | `/canned-responses` | Gestisci risposte predefinite |
| CRUD | `/kb/categories` | Gestisci categorie KB |
| CRUD | `/kb/articles` | Gestisci articoli KB |
| POST | `/import/tickets` | Importazione massiva ticket |
| POST | `/2fa/generate` | Genera segreto 2FA |
| POST | `/2fa/enable` | Abilita 2FA |
| GET | `/audit-logs` | Visualizza log di audit |

### Customer Routes (`/escalated/customer/`)

| Metodo | Percorso | Descrizione |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Elenco ticket propri |
| POST | `/tickets` | Crea ticket |
| GET | `/tickets/:id` | Visualizza ticket proprio |
| POST | `/tickets/:id/replies` | Rispondi al proprio ticket |
| POST | `/tickets/:id/rate` | Invia valutazione CSAT |
| GET | `/kb/categories` | Sfoglia categorie KB |
| GET | `/kb/articles` | Sfoglia articoli KB |
| GET | `/kb/search` | Cerca in KB |

### Widget Routes (`/escalated/widget/`)

| Metodo | Percorso | Descrizione |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Crea ticket (pubblico) |
| GET | `/tickets/:id` | Visualizza ticket (token ospite) |
| POST | `/tickets/:id/replies` | Rispondi (token ospite) |
| GET | `/kb/search` | Cerca in KB |
| POST | `/rate/:token` | Invia CSAT |

## Utilizzo diretto dei servizi

Tutti i servizi sono esportati e possono essere iniettati nel proprio codice:

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

## Eventi

Il modulo emette eventi tramite `@nestjs/event-emitter`:

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

## Aggiornamenti in tempo reale

Abilitare il broadcasting WebSocket per aggiornamenti ticket in tempo reale:

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

## Sviluppo

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## Entità TypeORM

Tutte le 32 entità sono esportate e prefissate con `escalated_`:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Licenza

MIT
