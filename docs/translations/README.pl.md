<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <a href="README.fr.md">Français</a> •
  <a href="README.it.md">Italiano</a> •
  <a href="README.ja.md">日本語</a> •
  <a href="README.ko.md">한국어</a> •
  <a href="README.nl.md">Nederlands</a> •
  <b>Polski</b> •
  <a href="README.pt-BR.md">Português (BR)</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.tr.md">Türkçe</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

Wbudowany moduł helpdesk dla aplikacji NestJS. Gotowy system zgłoszeń, zarządzanie SLA, baza wiedzy i więcej.

## Funkcje

- **Ticket Management** -- Pełne zarządzanie ze śledzeniem cyklu życia, priorytetami, działami, tagami i polami niestandardowymi
- **SLA Policies** -- Konfigurowalne cele odpowiedzi/rozwiązania ze wsparciem godzin pracy
- **Automations** -- Przetwarzanie czasowe przez `@nestjs/schedule` (sprawdzanie SLA, budzenie odkładania, ponawianie webhooków)
- **Escalation Rules** -- Automatyczne ponowne przypisanie i powiadomienia przy naruszeniu SLA
- **Macros & Canned Responses** -- Makra wieloakcyjne jednym kliknięciem i szablonowe odpowiedzi
- **Custom Fields** -- Dynamiczne pola z walidacją (tekst, liczba, wybór, pole wyboru, data)
- **Knowledge Base** -- Artykuły z kategoriami, wyszukiwaniem, śledzeniem wyświetleń i ocenami przydatności
- **Webhooks** -- Dostarczanie podpisane HMAC z ponowieniem z wykładniczym wycofaniem
- **API Tokens** -- Uwierzytelnianie tokenem Bearer z ograniczonymi uprawnieniami
- **Roles & Permissions** -- Szczegółowy system uprawnień z guardami NestJS
- **Audit Logging** -- Śledzenie aktywności oparte na interceptorach dla wszystkich mutacji
- **Import System** -- Masowy import zgłoszeń, tagów i działów
- **Side Conversations** -- Dyskusje wątkowe wewnątrz zgłoszenia
- **Ticket Merging & Linking** -- Łączenie duplikatów, wiązanie powiązanych zgłoszeń
- **Ticket Splitting** -- Dzielenie zgłoszenia na oddzielne problemy
- **Ticket Snooze** -- Odkładanie z automatycznym budzeniem przez cron
- **Saved Views** -- Osobiste i współdzielone filtrowane widoki
- **Widget API** -- Publiczne endpointy dla osadzalnego widgetu wsparcia z ograniczeniem szybkości
- **Real-time Broadcasting** -- Brama Socket.IO dla aktualizacji na żywo (opcjonalnie)
- **Capacity Management** -- Limity zgłoszeń na agenta ze śledzeniem w czasie rzeczywistym
- **Skill-based Routing** -- Przypisywanie zgłoszeń na podstawie umiejętności i dostępności agentów
- **CSAT Ratings** -- Ankiety satysfakcji po rozwiązaniu z wysyłaniem opartym na tokenie
- **2FA (TOTP)** -- Uwierzytelnianie dwuskładnikowe dla agentów przez `otplib`
- **Guest Access** -- Dostęp do zgłoszeń oparty na tokenie bez uwierzytelniania

## Wymagania

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Instalacja

```bash
npm install @escalated-dev/escalated-nestjs
```

## Konfiguracja

### 1. Importuj moduł

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

### 2. Opcje konfiguracji

| Option                | Type       | Default       | Opis                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | Prefiks URL dla wszystkich tras               |
| `enableWebsockets`    | `boolean`  | `false`       | Włącz transmisję Socket.IO w czasie rzeczywistym |
| `enableKnowledgeBase` | `boolean`  | `true`        | Włącz artykuły i kategorie KB       |
| `enableCsat`          | `boolean`  | `true`        | Włącz ankiety satysfakcji             |
| `enable2fa`           | `boolean`  | `false`       | Włącz TOTP 2FA dla agentów              |
| `appName`             | `string`   | `'Escalated'` | Nazwa marki dla e-maili                |
| `appUrl`              | `string`   | --            | Bazowy URL dla linków                      |
| `maxFileSize`         | `number`   | `10485760`    | Maksymalny rozmiar przesyłania w bajtach                |
| `webhookMaxRetries`   | `number`   | `3`           | Próby ponowienia webhook                  |
| `widgetOrigins`       | `string[]` | `['*']`       | Źródła CORS dla widgetu                 |
| `adminGuard`          | `class`    | --            | Niestandardowy guard dla tras administratora           |
| `agentGuard`          | `class`    | --            | Niestandardowy guard dla tras agenta           |
| `customerGuard`       | `class`    | --            | Niestandardowy guard dla tras klienta        |
| `userResolver`        | `function` | --            | Wyodrębnij użytkownika z żądania               |

### 3. Migracja bazy danych

Z `synchronize: true`, TypeORM automatycznie tworzy tabele. Dla produkcji, wygeneruj migracje:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Wszystkie tabele mają prefiks `escalated_`, aby uniknąć konfliktów.

## Endpointy API

### Agent Routes (`/escalated/agent/`)

| Metoda | Ścieżka | Opis |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Lista zgłoszeń z filtrami |
| POST | `/tickets` | Utwórz zgłoszenie |
| GET | `/tickets/:id` | Pokaż zgłoszenie z odpowiedziami |
| PUT | `/tickets/:id` | Zaktualizuj zgłoszenie |
| DELETE | `/tickets/:id` | Usuń zgłoszenie |
| POST | `/tickets/:id/replies` | Dodaj odpowiedź |
| POST | `/tickets/:id/merge/:targetId` | Scal zgłoszenia |
| POST | `/tickets/:id/split` | Podziel zgłoszenie |
| POST | `/tickets/:id/snooze` | Odłóż zgłoszenie |
| GET | `/tickets/:ticketId/links` | Lista linków zgłoszeń |
| POST | `/tickets/:ticketId/links` | Powiąż zgłoszenia |
| GET | `/tickets/:ticketId/side-conversations` | Lista konwersacji pobocznych |
| POST | `/tickets/:ticketId/side-conversations` | Utwórz konwersację poboczną |
| GET | `/macros` | Lista makr |
| POST | `/macros/:macroId/execute/:ticketId` | Wykonaj makro |
| GET | `/canned-responses` | Lista szablonów odpowiedzi |
| GET | `/saved-views` | Lista zapisanych widoków |
| POST | `/saved-views` | Utwórz zapisany widok |

### Admin Routes (`/escalated/admin/`)

| Metoda | Ścieżka | Opis |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Zarządzaj ustawieniami |
| CRUD | `/departments` | Zarządzaj działami |
| CRUD | `/tags` | Zarządzaj tagami |
| CRUD | `/custom-fields` | Zarządzaj polami niestandardowymi |
| CRUD | `/roles` | Zarządzaj rolami |
| CRUD | `/sla/policies` | Zarządzaj politykami SLA |
| CRUD | `/sla/escalation-rules` | Zarządzaj regułami eskalacji |
| CRUD | `/sla/schedules` | Zarządzaj harmonogramami pracy |
| CRUD | `/webhooks` | Zarządzaj webhookami |
| CRUD | `/api-tokens` | Zarządzaj tokenami API |
| CRUD | `/agents` | Zarządzaj profilami agentów |
| CRUD | `/macros` | Zarządzaj makrami |
| CRUD | `/canned-responses` | Zarządzaj szablonami odpowiedzi |
| CRUD | `/kb/categories` | Zarządzaj kategoriami KB |
| CRUD | `/kb/articles` | Zarządzaj artykułami KB |
| POST | `/import/tickets` | Masowy import zgłoszeń |
| POST | `/2fa/generate` | Wygeneruj sekret 2FA |
| POST | `/2fa/enable` | Włącz 2FA |
| GET | `/audit-logs` | Wyświetl dzienniki audytu |

### Customer Routes (`/escalated/customer/`)

| Metoda | Ścieżka | Opis |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Lista własnych zgłoszeń |
| POST | `/tickets` | Utwórz zgłoszenie |
| GET | `/tickets/:id` | Wyświetl własne zgłoszenie |
| POST | `/tickets/:id/replies` | Odpowiedz na własne zgłoszenie |
| POST | `/tickets/:id/rate` | Wyślij ocenę CSAT |
| GET | `/kb/categories` | Przeglądaj kategorie KB |
| GET | `/kb/articles` | Przeglądaj artykuły KB |
| GET | `/kb/search` | Szukaj w KB |

### Widget Routes (`/escalated/widget/`)

| Metoda | Ścieżka | Opis |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Utwórz zgłoszenie (publiczne) |
| GET | `/tickets/:id` | Wyświetl zgłoszenie (token gościa) |
| POST | `/tickets/:id/replies` | Odpowiedz (token gościa) |
| GET | `/kb/search` | Szukaj w KB |
| POST | `/rate/:token` | Wyślij CSAT |

## Bezpośrednie użycie usług

Wszystkie usługi są wyeksportowane i mogą być wstrzyknięte do własnego kodu:

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

## Zdarzenia

Moduł emituje zdarzenia przez `@nestjs/event-emitter`:

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

## Aktualizacje w czasie rzeczywistym

Włącz transmisję WebSocket dla aktualizacji zgłoszeń na żywo:

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

## Programowanie

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## Encje TypeORM

Wszystkie 32 encje są wyeksportowane i mają prefiks `escalated_`:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Licencja

MIT
