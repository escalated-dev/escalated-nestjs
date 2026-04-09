<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <b>Español</b> •
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

Módulo de helpdesk integrado para aplicaciones NestJS. Sistema de tickets listo para usar, gestión de SLA, base de conocimientos y más.

## Características

- **Ticket Management** -- Gestión completa con seguimiento del ciclo de vida, prioridades, departamentos, etiquetas y campos personalizados
- **SLA Policies** -- Objetivos de respuesta/resolución configurables con soporte de horario comercial
- **Automations** -- Procesamiento basado en tiempo mediante `@nestjs/schedule` (verificaciones SLA, despertar de posposición, reintentos de webhook)
- **Escalation Rules** -- Reasignación automática y notificaciones por incumplimiento de SLA
- **Macros & Canned Responses** -- Macros de acción múltiple con un clic y respuestas con plantilla
- **Custom Fields** -- Campos dinámicos con validación (texto, número, selección, casilla, fecha)
- **Knowledge Base** -- Artículos con categorías, búsqueda, seguimiento de vistas y calificaciones de utilidad
- **Webhooks** -- Entrega firmada con HMAC con reintento de retroceso exponencial
- **API Tokens** -- Autenticación con token Bearer con capacidades delimitadas
- **Roles & Permissions** -- Sistema de permisos granular con guards de NestJS
- **Audit Logging** -- Seguimiento de actividad basado en interceptores para todas las mutaciones
- **Import System** -- Importación masiva de tickets, etiquetas y departamentos
- **Side Conversations** -- Discusiones con hilos dentro de un ticket
- **Ticket Merging & Linking** -- Fusionar duplicados, vincular tickets relacionados
- **Ticket Splitting** -- Dividir un ticket en problemas separados
- **Ticket Snooze** -- Posponer con despertar automático mediante cron
- **Saved Views** -- Vistas filtradas personales y compartidas
- **Widget API** -- Endpoints públicos para widget de soporte integrable con limitación de velocidad
- **Real-time Broadcasting** -- Gateway Socket.IO para actualizaciones en vivo (opcional)
- **Capacity Management** -- Límites de tickets por agente con seguimiento en tiempo real
- **Skill-based Routing** -- Asignar tickets según habilidades y disponibilidad del agente
- **CSAT Ratings** -- Encuestas de satisfacción post-resolución con envío basado en token
- **2FA (TOTP)** -- Autenticación de dos factores para agentes mediante `otplib`
- **Guest Access** -- Acceso a tickets basado en token sin autenticación

## Requisitos

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Instalación

```bash
npm install @escalated-dev/escalated-nestjs
```

## Configuración

### 1. Importar el módulo

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

### 2. Opciones de configuración

| Option                | Type       | Default       | Descripción                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | Prefijo de URL para todas las rutas               |
| `enableWebsockets`    | `boolean`  | `false`       | Habilitar transmisión en tiempo real de Socket.IO |
| `enableKnowledgeBase` | `boolean`  | `true`        | Habilitar artículos y categorías de KB       |
| `enableCsat`          | `boolean`  | `true`        | Habilitar encuestas de satisfacción             |
| `enable2fa`           | `boolean`  | `false`       | Habilitar TOTP 2FA para agentes              |
| `appName`             | `string`   | `'Escalated'` | Nombre de marca para correos                |
| `appUrl`              | `string`   | --            | URL base para enlaces                      |
| `maxFileSize`         | `number`   | `10485760`    | Tamaño máximo de carga en bytes                |
| `webhookMaxRetries`   | `number`   | `3`           | Intentos de reintento de webhook                  |
| `widgetOrigins`       | `string[]` | `['*']`       | Orígenes CORS para el widget                 |
| `adminGuard`          | `class`    | --            | Guard personalizado para rutas de administrador           |
| `agentGuard`          | `class`    | --            | Guard personalizado para rutas de agente           |
| `customerGuard`       | `class`    | --            | Guard personalizado para rutas de cliente        |
| `userResolver`        | `function` | --            | Extraer usuario de la solicitud               |

### 3. Migración de base de datos

Con `synchronize: true`, TypeORM crea tablas automáticamente. Para producción, genere migraciones:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Todas las tablas llevan el prefijo `escalated_` para evitar conflictos.

## Endpoints de API

### Agent Routes (`/escalated/agent/`)

| Método | Ruta | Descripción |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Listar tickets con filtros |
| POST | `/tickets` | Crear ticket |
| GET | `/tickets/:id` | Mostrar ticket con respuestas |
| PUT | `/tickets/:id` | Actualizar ticket |
| DELETE | `/tickets/:id` | Eliminar ticket |
| POST | `/tickets/:id/replies` | Agregar respuesta |
| POST | `/tickets/:id/merge/:targetId` | Fusionar tickets |
| POST | `/tickets/:id/split` | Dividir ticket |
| POST | `/tickets/:id/snooze` | Posponer ticket |
| GET | `/tickets/:ticketId/links` | Listar enlaces de tickets |
| POST | `/tickets/:ticketId/links` | Vincular tickets |
| GET | `/tickets/:ticketId/side-conversations` | Listar conversaciones laterales |
| POST | `/tickets/:ticketId/side-conversations` | Crear conversación lateral |
| GET | `/macros` | Listar macros |
| POST | `/macros/:macroId/execute/:ticketId` | Ejecutar macro |
| GET | `/canned-responses` | Listar respuestas predefinidas |
| GET | `/saved-views` | Listar vistas guardadas |
| POST | `/saved-views` | Crear vista guardada |

### Admin Routes (`/escalated/admin/`)

| Método | Ruta | Descripción |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Gestionar configuraciones |
| CRUD | `/departments` | Gestionar departamentos |
| CRUD | `/tags` | Gestionar etiquetas |
| CRUD | `/custom-fields` | Gestionar campos personalizados |
| CRUD | `/roles` | Gestionar roles |
| CRUD | `/sla/policies` | Gestionar políticas SLA |
| CRUD | `/sla/escalation-rules` | Gestionar reglas de escalamiento |
| CRUD | `/sla/schedules` | Gestionar horarios comerciales |
| CRUD | `/webhooks` | Gestionar webhooks |
| CRUD | `/api-tokens` | Gestionar tokens API |
| CRUD | `/agents` | Gestionar perfiles de agentes |
| CRUD | `/macros` | Gestionar macros |
| CRUD | `/canned-responses` | Gestionar respuestas predefinidas |
| CRUD | `/kb/categories` | Gestionar categorías de KB |
| CRUD | `/kb/articles` | Gestionar artículos de KB |
| POST | `/import/tickets` | Importación masiva de tickets |
| POST | `/2fa/generate` | Generar secreto 2FA |
| POST | `/2fa/enable` | Habilitar 2FA |
| GET | `/audit-logs` | Ver registros de auditoría |

### Customer Routes (`/escalated/customer/`)

| Método | Ruta | Descripción |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Listar tickets propios |
| POST | `/tickets` | Crear ticket |
| GET | `/tickets/:id` | Ver ticket propio |
| POST | `/tickets/:id/replies` | Responder a ticket propio |
| POST | `/tickets/:id/rate` | Enviar calificación CSAT |
| GET | `/kb/categories` | Explorar categorías de KB |
| GET | `/kb/articles` | Explorar artículos de KB |
| GET | `/kb/search` | Buscar en KB |

### Widget Routes (`/escalated/widget/`)

| Método | Ruta | Descripción |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Crear ticket (público) |
| GET | `/tickets/:id` | Ver ticket (token invitado) |
| POST | `/tickets/:id/replies` | Responder (token invitado) |
| GET | `/kb/search` | Buscar en KB |
| POST | `/rate/:token` | Enviar CSAT |

## Uso directo de servicios

Todos los servicios están exportados y se pueden inyectar en su propio código:

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

## Eventos

El módulo emite eventos a través de `@nestjs/event-emitter`:

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

## Actualizaciones en tiempo real

Habilitar transmisión WebSocket para actualizaciones de tickets en vivo:

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

## Desarrollo

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## Entidades TypeORM

Las 32 entidades están exportadas y prefijadas con `escalated_`:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Licencia

MIT
