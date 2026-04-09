<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <b>Français</b> •
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

Module de helpdesk intégré pour les applications NestJS. Système de ticketing prêt à l'emploi, gestion SLA, base de connaissances et plus encore.

## Fonctionnalités

- **Ticket Management** -- Gestion complète avec suivi du cycle de vie, priorités, départements, tags et champs personnalisés
- **SLA Policies** -- Objectifs de réponse/résolution configurables avec support des heures ouvrables
- **Automations** -- Traitement temporel via `@nestjs/schedule` (vérifications SLA, réveil de mise en veille, réessais webhook)
- **Escalation Rules** -- Réaffectation automatique et notifications en cas de violation SLA
- **Macros & Canned Responses** -- Macros multi-actions en un clic et réponses modèles
- **Custom Fields** -- Champs dynamiques avec validation (texte, nombre, sélection, case à cocher, date)
- **Knowledge Base** -- Articles avec catégories, recherche, suivi des vues et évaluations d'utilité
- **Webhooks** -- Livraison signée HMAC avec réessai à backoff exponentiel
- **API Tokens** -- Authentification par jeton Bearer avec capacités limitées
- **Roles & Permissions** -- Système de permissions granulaire avec guards NestJS
- **Audit Logging** -- Suivi d'activité basé sur les intercepteurs pour toutes les mutations
- **Import System** -- Import en masse de tickets, tags et départements
- **Side Conversations** -- Discussions en fil au sein d'un ticket
- **Ticket Merging & Linking** -- Fusionner les doublons, lier les tickets associés
- **Ticket Splitting** -- Diviser un ticket en problèmes séparés
- **Ticket Snooze** -- Mise en veille avec réveil automatique via cron
- **Saved Views** -- Vues filtrées personnelles et partagées
- **Widget API** -- Points de terminaison publics pour widget d'assistance intégrable avec limitation de débit
- **Real-time Broadcasting** -- Gateway Socket.IO pour mises à jour en direct (optionnel)
- **Capacity Management** -- Limites de tickets par agent avec suivi en temps réel
- **Skill-based Routing** -- Affecter les tickets selon les compétences et la disponibilité des agents
- **CSAT Ratings** -- Enquêtes de satisfaction post-résolution avec soumission par jeton
- **2FA (TOTP)** -- Authentification à deux facteurs pour les agents via `otplib`
- **Guest Access** -- Accès aux tickets par jeton sans authentification

## Prérequis

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Installation

```bash
npm install @escalated-dev/escalated-nestjs
```

## Configuration

### 1. Importer le module

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

### 2. Options de configuration

| Option                | Type       | Default       | Description                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | Préfixe URL pour toutes les routes               |
| `enableWebsockets`    | `boolean`  | `false`       | Activer la diffusion Socket.IO en temps réel |
| `enableKnowledgeBase` | `boolean`  | `true`        | Activer les articles et catégories KB       |
| `enableCsat`          | `boolean`  | `true`        | Activer les enquêtes de satisfaction             |
| `enable2fa`           | `boolean`  | `false`       | Activer TOTP 2FA pour les agents              |
| `appName`             | `string`   | `'Escalated'` | Nom de marque pour les e-mails                |
| `appUrl`              | `string`   | --            | URL de base pour les liens                      |
| `maxFileSize`         | `number`   | `10485760`    | Taille max de téléchargement en octets                |
| `webhookMaxRetries`   | `number`   | `3`           | Tentatives de réessai webhook                  |
| `widgetOrigins`       | `string[]` | `['*']`       | Origines CORS pour le widget                 |
| `adminGuard`          | `class`    | --            | Guard personnalisé pour les routes admin           |
| `agentGuard`          | `class`    | --            | Guard personnalisé pour les routes agent           |
| `customerGuard`       | `class`    | --            | Guard personnalisé pour les routes client        |
| `userResolver`        | `function` | --            | Extraire l'utilisateur de la requête               |

### 3. Migration de la base de données

Avec `synchronize: true`, TypeORM crée automatiquement les tables. Pour la production, générez des migrations :

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Toutes les tables sont préfixées par `escalated_` pour éviter les conflits.

## Points de terminaison API

### Agent Routes (`/escalated/agent/`)

| Méthode | Chemin | Description |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Lister les tickets avec filtres |
| POST | `/tickets` | Créer un ticket |
| GET | `/tickets/:id` | Afficher le ticket avec réponses |
| PUT | `/tickets/:id` | Mettre à jour un ticket |
| DELETE | `/tickets/:id` | Supprimer un ticket |
| POST | `/tickets/:id/replies` | Ajouter une réponse |
| POST | `/tickets/:id/merge/:targetId` | Fusionner des tickets |
| POST | `/tickets/:id/split` | Diviser un ticket |
| POST | `/tickets/:id/snooze` | Mettre en veille un ticket |
| GET | `/tickets/:ticketId/links` | Lister les liens de tickets |
| POST | `/tickets/:ticketId/links` | Lier des tickets |
| GET | `/tickets/:ticketId/side-conversations` | Lister les conversations parallèles |
| POST | `/tickets/:ticketId/side-conversations` | Créer une conversation parallèle |
| GET | `/macros` | Lister les macros |
| POST | `/macros/:macroId/execute/:ticketId` | Exécuter une macro |
| GET | `/canned-responses` | Lister les réponses prédéfinies |
| GET | `/saved-views` | Lister les vues enregistrées |
| POST | `/saved-views` | Créer une vue enregistrée |

### Admin Routes (`/escalated/admin/`)

| Méthode | Chemin | Description |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Gérer les paramètres |
| CRUD | `/departments` | Gérer les départements |
| CRUD | `/tags` | Gérer les tags |
| CRUD | `/custom-fields` | Gérer les champs personnalisés |
| CRUD | `/roles` | Gérer les rôles |
| CRUD | `/sla/policies` | Gérer les politiques SLA |
| CRUD | `/sla/escalation-rules` | Gérer les règles d'escalade |
| CRUD | `/sla/schedules` | Gérer les plannings |
| CRUD | `/webhooks` | Gérer les webhooks |
| CRUD | `/api-tokens` | Gérer les jetons API |
| CRUD | `/agents` | Gérer les profils agents |
| CRUD | `/macros` | Gérer les macros |
| CRUD | `/canned-responses` | Gérer les réponses prédéfinies |
| CRUD | `/kb/categories` | Gérer les catégories KB |
| CRUD | `/kb/articles` | Gérer les articles KB |
| POST | `/import/tickets` | Import en masse de tickets |
| POST | `/2fa/generate` | Générer le secret 2FA |
| POST | `/2fa/enable` | Activer 2FA |
| GET | `/audit-logs` | Voir les journaux d'audit |

### Customer Routes (`/escalated/customer/`)

| Méthode | Chemin | Description |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Lister ses tickets |
| POST | `/tickets` | Créer un ticket |
| GET | `/tickets/:id` | Voir son ticket |
| POST | `/tickets/:id/replies` | Répondre à son ticket |
| POST | `/tickets/:id/rate` | Soumettre une évaluation CSAT |
| GET | `/kb/categories` | Parcourir les catégories KB |
| GET | `/kb/articles` | Parcourir les articles KB |
| GET | `/kb/search` | Rechercher dans KB |

### Widget Routes (`/escalated/widget/`)

| Méthode | Chemin | Description |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Créer un ticket (public) |
| GET | `/tickets/:id` | Voir le ticket (jeton invité) |
| POST | `/tickets/:id/replies` | Répondre (jeton invité) |
| GET | `/kb/search` | Rechercher dans KB |
| POST | `/rate/:token` | Soumettre CSAT |

## Utiliser les services directement

Tous les services sont exportés et peuvent être injectés dans votre propre code :

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

## Événements

Le module émet des événements via `@nestjs/event-emitter` :

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

## Mises à jour en temps réel

Activer la diffusion WebSocket pour les mises à jour de tickets en direct :

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

## Développement

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## Entités TypeORM

Les 32 entités sont exportées et préfixées par `escalated_` :

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Licence

MIT
