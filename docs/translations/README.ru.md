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
  <a href="README.pl.md">Polski</a> •
  <a href="README.pt-BR.md">Português (BR)</a> •
  <b>Русский</b> •
  <a href="README.tr.md">Türkçe</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

Встроенный модуль helpdesk для приложений NestJS. Готовая система тикетов, управление SLA, база знаний и многое другое.

## Возможности

- **Ticket Management** -- Полное управление с отслеживанием жизненного цикла, приоритетами, отделами, тегами и пользовательскими полями
- **SLA Policies** -- Настраиваемые цели ответа/решения с поддержкой рабочего времени
- **Automations** -- Временная обработка через `@nestjs/schedule` (проверки SLA, пробуждение откладывания, повторы webhook)
- **Escalation Rules** -- Автоматическое переназначение и уведомления при нарушении SLA
- **Macros & Canned Responses** -- Макросы с несколькими действиями в один клик и шаблонные ответы
- **Custom Fields** -- Динамические поля с валидацией (текст, число, выбор, чекбокс, дата)
- **Knowledge Base** -- Статьи с категориями, поиском, отслеживанием просмотров и оценками полезности
- **Webhooks** -- HMAC-подписанная доставка с экспоненциальным откатом повторов
- **API Tokens** -- Аутентификация Bearer-токенами с ограниченными правами
- **Roles & Permissions** -- Детальная система разрешений с guards NestJS
- **Audit Logging** -- Отслеживание активности на основе перехватчиков для всех мутаций
- **Import System** -- Массовый импорт заявок, тегов и отделов
- **Side Conversations** -- Обсуждения в потоках внутри заявки
- **Ticket Merging & Linking** -- Объединение дубликатов, связывание связанных заявок
- **Ticket Splitting** -- Разделение заявки на отдельные проблемы
- **Ticket Snooze** -- Откладывание с автоматическим пробуждением через cron
- **Saved Views** -- Личные и общие фильтрованные представления
- **Widget API** -- Публичные эндпоинты для встраиваемого виджета поддержки с ограничением скорости
- **Real-time Broadcasting** -- Шлюз Socket.IO для обновлений в реальном времени (опционально)
- **Capacity Management** -- Ограничения заявок на агента с отслеживанием в реальном времени
- **Skill-based Routing** -- Назначение заявок на основе навыков и доступности агентов
- **CSAT Ratings** -- Опросы удовлетворённости после решения с отправкой по токену
- **2FA (TOTP)** -- Двухфакторная аутентификация для агентов через `otplib`
- **Guest Access** -- Доступ к заявкам по токену без аутентификации

## Требования

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Установка

```bash
npm install @escalated-dev/escalated-nestjs
```

## Настройка

### 1. Импорт модуля

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

### 2. Параметры конфигурации

| Option                | Type       | Default       | Описание                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | URL-префикс для всех маршрутов               |
| `enableWebsockets`    | `boolean`  | `false`       | Включить Socket.IO вещание в реальном времени |
| `enableKnowledgeBase` | `boolean`  | `true`        | Включить статьи и категории базы знаний       |
| `enableCsat`          | `boolean`  | `true`        | Включить опросы удовлетворённости             |
| `enable2fa`           | `boolean`  | `false`       | Включить TOTP 2FA для агентов              |
| `appName`             | `string`   | `'Escalated'` | Название бренда для писем                |
| `appUrl`              | `string`   | --            | Базовый URL для ссылок                      |
| `maxFileSize`         | `number`   | `10485760`    | Макс. размер загрузки в байтах                |
| `webhookMaxRetries`   | `number`   | `3`           | Количество повторов webhook                  |
| `widgetOrigins`       | `string[]` | `['*']`       | CORS-источники для виджета                 |
| `adminGuard`          | `class`    | --            | Пользовательский guard для маршрутов администратора           |
| `agentGuard`          | `class`    | --            | Пользовательский guard для маршрутов агента           |
| `customerGuard`       | `class`    | --            | Пользовательский guard для маршрутов клиента        |
| `userResolver`        | `function` | --            | Извлечь пользователя из запроса               |

### 3. Миграция базы данных

С `synchronize: true` TypeORM автоматически создаёт таблицы. Для продакшена сгенерируйте миграции:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Все таблицы имеют префикс `escalated_` во избежание конфликтов.

## Эндпоинты API

### Agent Routes (`/escalated/agent/`)

| Метод | Путь | Описание |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Список заявок с фильтрами |
| POST | `/tickets` | Создать заявку |
| GET | `/tickets/:id` | Показать заявку с ответами |
| PUT | `/tickets/:id` | Обновить заявку |
| DELETE | `/tickets/:id` | Удалить заявку |
| POST | `/tickets/:id/replies` | Добавить ответ |
| POST | `/tickets/:id/merge/:targetId` | Объединить заявки |
| POST | `/tickets/:id/split` | Разделить заявку |
| POST | `/tickets/:id/snooze` | Отложить заявку |
| GET | `/tickets/:ticketId/links` | Список связей заявок |
| POST | `/tickets/:ticketId/links` | Связать заявки |
| GET | `/tickets/:ticketId/side-conversations` | Список побочных бесед |
| POST | `/tickets/:ticketId/side-conversations` | Создать побочную беседу |
| GET | `/macros` | Список макросов |
| POST | `/macros/:macroId/execute/:ticketId` | Выполнить макрос |
| GET | `/canned-responses` | Список шаблонов ответов |
| GET | `/saved-views` | Список сохранённых представлений |
| POST | `/saved-views` | Создать сохранённое представление |

### Admin Routes (`/escalated/admin/`)

| Метод | Путь | Описание |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Управление настройками |
| CRUD | `/departments` | Управление отделами |
| CRUD | `/tags` | Управление тегами |
| CRUD | `/custom-fields` | Управление пользовательскими полями |
| CRUD | `/roles` | Управление ролями |
| CRUD | `/sla/policies` | Управление политиками SLA |
| CRUD | `/sla/escalation-rules` | Управление правилами эскалации |
| CRUD | `/sla/schedules` | Управление расписаниями |
| CRUD | `/webhooks` | Управление вебхуками |
| CRUD | `/api-tokens` | Управление API-токенами |
| CRUD | `/agents` | Управление профилями агентов |
| CRUD | `/macros` | Управление макросами |
| CRUD | `/canned-responses` | Управление шаблонами ответов |
| CRUD | `/kb/categories` | Управление категориями базы знаний |
| CRUD | `/kb/articles` | Управление статьями базы знаний |
| POST | `/import/tickets` | Массовый импорт заявок |
| POST | `/2fa/generate` | Генерация секрета 2FA |
| POST | `/2fa/enable` | Включение 2FA |
| GET | `/audit-logs` | Просмотр журналов аудита |

### Customer Routes (`/escalated/customer/`)

| Метод | Путь | Описание |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Список своих заявок |
| POST | `/tickets` | Создать заявку |
| GET | `/tickets/:id` | Просмотр своей заявки |
| POST | `/tickets/:id/replies` | Ответ на свою заявку |
| POST | `/tickets/:id/rate` | Отправка оценки CSAT |
| GET | `/kb/categories` | Просмотр категорий базы знаний |
| GET | `/kb/articles` | Просмотр статей базы знаний |
| GET | `/kb/search` | Поиск по базе знаний |

### Widget Routes (`/escalated/widget/`)

| Метод | Путь | Описание |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Создать заявку (публичную) |
| GET | `/tickets/:id` | Просмотр заявки (гостевой токен) |
| POST | `/tickets/:id/replies` | Ответ (гостевой токен) |
| GET | `/kb/search` | Поиск по базе знаний |
| POST | `/rate/:token` | Отправить CSAT |

## Прямое использование сервисов

Все сервисы экспортированы и могут быть внедрены в ваш собственный код:

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

## События

Модуль генерирует события через `@nestjs/event-emitter`:

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

## Обновления в реальном времени

Включите WebSocket-вещание для обновлений заявок в реальном времени:

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

## Разработка

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## Сущности TypeORM

Все 32 сущности экспортированы и имеют префикс `escalated_`:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Лицензия

MIT
