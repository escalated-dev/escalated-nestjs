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
  <b>Português (BR)</b> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.tr.md">Türkçe</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

Módulo de helpdesk embutido para aplicações NestJS. Ticketing drop-in, gerenciamento de SLA, base de conhecimento e mais.

## Funcionalidades

- **Ticket Management** -- Gerenciamento completo com rastreamento de ciclo de vida, prioridades, departamentos, tags e campos personalizados
- **SLA Policies** -- Metas de resposta/resolução configuráveis com suporte a horário comercial
- **Automations** -- Processamento baseado em tempo via `@nestjs/schedule` (verificações SLA, despertar de adiamento, repetições de webhook)
- **Escalation Rules** -- Reatribuição automática e notificações por violação de SLA
- **Macros & Canned Responses** -- Macros de ação múltipla com um clique e respostas com modelo
- **Custom Fields** -- Campos dinâmicos com validação (texto, número, seleção, caixa de seleção, data)
- **Knowledge Base** -- Artigos com categorias, busca, rastreamento de visualizações e avaliações de utilidade
- **Webhooks** -- Entrega assinada com HMAC com repetição de recuo exponencial
- **API Tokens** -- Autenticação com token Bearer com capacidades delimitadas
- **Roles & Permissions** -- Sistema de permissões granular com guards do NestJS
- **Audit Logging** -- Rastreamento de atividade baseado em interceptor para todas as mutações
- **Import System** -- Importação em massa de tickets, tags e departamentos
- **Side Conversations** -- Discussões com threads dentro de um ticket
- **Ticket Merging & Linking** -- Mesclar duplicatas, vincular tickets relacionados
- **Ticket Splitting** -- Dividir um ticket em problemas separados
- **Ticket Snooze** -- Adiamento com despertar automático via cron
- **Saved Views** -- Visualizações filtradas pessoais e compartilhadas
- **Widget API** -- Endpoints públicos para widget de suporte incorporável com limitação de taxa
- **Real-time Broadcasting** -- Gateway Socket.IO para atualizações ao vivo (opcional)
- **Capacity Management** -- Limites de tickets por agente com rastreamento em tempo real
- **Skill-based Routing** -- Atribuir tickets com base em habilidades e disponibilidade do agente
- **CSAT Ratings** -- Pesquisas de satisfação pós-resolução com envio baseado em token
- **2FA (TOTP)** -- Autenticação de dois fatores para agentes via `otplib`
- **Guest Access** -- Acesso a tickets baseado em token sem autenticação

## Requisitos

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Instalação

```bash
npm install @escalated-dev/escalated-nestjs
```

## Configuração

### 1. Importar o módulo

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

### 2. Opções de configuração

| Option                | Type       | Default       | Descrição                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | Prefixo de URL para todas as rotas               |
| `enableWebsockets`    | `boolean`  | `false`       | Ativar transmissão Socket.IO em tempo real |
| `enableKnowledgeBase` | `boolean`  | `true`        | Ativar artigos e categorias da KB       |
| `enableCsat`          | `boolean`  | `true`        | Ativar pesquisas de satisfação             |
| `enable2fa`           | `boolean`  | `false`       | Ativar TOTP 2FA para agentes              |
| `appName`             | `string`   | `'Escalated'` | Nome da marca para e-mails                |
| `appUrl`              | `string`   | --            | URL base para links                      |
| `maxFileSize`         | `number`   | `10485760`    | Tamanho máximo de upload em bytes                |
| `webhookMaxRetries`   | `number`   | `3`           | Tentativas de repetição de webhook                  |
| `widgetOrigins`       | `string[]` | `['*']`       | Origens CORS para widget                 |
| `adminGuard`          | `class`    | --            | Guard personalizado para rotas de admin           |
| `agentGuard`          | `class`    | --            | Guard personalizado para rotas de agente           |
| `customerGuard`       | `class`    | --            | Guard personalizado para rotas de cliente        |
| `userResolver`        | `function` | --            | Extrair usuário da requisição               |

### 3. Migração do banco de dados

Com `synchronize: true`, o TypeORM cria tabelas automaticamente. Para produção, gere migrações:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Todas as tabelas são prefixadas com `escalated_` para evitar conflitos.

## Endpoints da API

### Agent Routes (`/escalated/agent/`)

| Método | Caminho | Descrição |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Listar tickets com filtros |
| POST | `/tickets` | Criar ticket |
| GET | `/tickets/:id` | Mostrar ticket com respostas |
| PUT | `/tickets/:id` | Atualizar ticket |
| DELETE | `/tickets/:id` | Excluir ticket |
| POST | `/tickets/:id/replies` | Adicionar resposta |
| POST | `/tickets/:id/merge/:targetId` | Mesclar tickets |
| POST | `/tickets/:id/split` | Dividir ticket |
| POST | `/tickets/:id/snooze` | Adiar ticket |
| GET | `/tickets/:ticketId/links` | Listar links de tickets |
| POST | `/tickets/:ticketId/links` | Vincular tickets |
| GET | `/tickets/:ticketId/side-conversations` | Listar conversas laterais |
| POST | `/tickets/:ticketId/side-conversations` | Criar conversa lateral |
| GET | `/macros` | Listar macros |
| POST | `/macros/:macroId/execute/:ticketId` | Executar macro |
| GET | `/canned-responses` | Listar respostas predefinidas |
| GET | `/saved-views` | Listar visualizações salvas |
| POST | `/saved-views` | Criar visualização salva |

### Admin Routes (`/escalated/admin/`)

| Método | Caminho | Descrição |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Gerenciar configurações |
| CRUD | `/departments` | Gerenciar departamentos |
| CRUD | `/tags` | Gerenciar tags |
| CRUD | `/custom-fields` | Gerenciar campos personalizados |
| CRUD | `/roles` | Gerenciar funções |
| CRUD | `/sla/policies` | Gerenciar políticas SLA |
| CRUD | `/sla/escalation-rules` | Gerenciar regras de escalonamento |
| CRUD | `/sla/schedules` | Gerenciar agendas comerciais |
| CRUD | `/webhooks` | Gerenciar webhooks |
| CRUD | `/api-tokens` | Gerenciar tokens API |
| CRUD | `/agents` | Gerenciar perfis de agentes |
| CRUD | `/macros` | Gerenciar macros |
| CRUD | `/canned-responses` | Gerenciar respostas predefinidas |
| CRUD | `/kb/categories` | Gerenciar categorias da KB |
| CRUD | `/kb/articles` | Gerenciar artigos da KB |
| POST | `/import/tickets` | Importação em massa de tickets |
| POST | `/2fa/generate` | Gerar segredo 2FA |
| POST | `/2fa/enable` | Ativar 2FA |
| GET | `/audit-logs` | Ver logs de auditoria |

### Customer Routes (`/escalated/customer/`)

| Método | Caminho | Descrição |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Listar tickets próprios |
| POST | `/tickets` | Criar ticket |
| GET | `/tickets/:id` | Ver ticket próprio |
| POST | `/tickets/:id/replies` | Responder ticket próprio |
| POST | `/tickets/:id/rate` | Enviar avaliação CSAT |
| GET | `/kb/categories` | Explorar categorias da KB |
| GET | `/kb/articles` | Explorar artigos da KB |
| GET | `/kb/search` | Pesquisar na KB |

### Widget Routes (`/escalated/widget/`)

| Método | Caminho | Descrição |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Criar ticket (público) |
| GET | `/tickets/:id` | Ver ticket (token convidado) |
| POST | `/tickets/:id/replies` | Responder (token convidado) |
| GET | `/kb/search` | Pesquisar na KB |
| POST | `/rate/:token` | Enviar CSAT |

## Usando serviços diretamente

Todos os serviços são exportados e podem ser injetados no seu próprio código:

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

O módulo emite eventos via `@nestjs/event-emitter`:

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

## Atualizações em tempo real

Ativar transmissão WebSocket para atualizações de tickets ao vivo:

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

## Desenvolvimento

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## Entidades TypeORM

Todas as 32 entidades são exportadas e prefixadas com `escalated_`:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Licença

MIT
