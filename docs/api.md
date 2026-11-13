# API reference

## API Endpoints

### Agent Routes (`/escalated/agent/`)

Protected by `agentGuard`.

| Method | Path                                    | Description               |
| ------ | --------------------------------------- | ------------------------- |
| GET    | `/tickets`                              | List tickets with filters |
| POST   | `/tickets`                              | Create ticket             |
| GET    | `/tickets/:id`                          | Show ticket with replies  |
| PUT    | `/tickets/:id`                          | Update ticket             |
| DELETE | `/tickets/:id`                          | Delete ticket             |
| POST   | `/tickets/:id/replies`                  | Add reply                 |
| POST   | `/tickets/:id/actions/:actionKey`       | Trigger custom action     |
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

Protected by `adminGuard`.

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
| CRUD    | `/workflows`            | Manage workflows (see [Workflows](workflows.md)) |
| CRUD    | `/canned-responses`     | Manage canned responses   |
| CRUD    | `/kb/categories`        | Manage KB categories      |
| CRUD    | `/kb/articles`          | Manage KB articles        |
| POST    | `/import/tickets`       | Bulk import tickets       |
| GET/POST | `/settings/two-factor[/setup,/confirm,/disable]` | Your own two-factor enrolment (any staff user; 404 unless `access.twoFactor`) |
| GET     | `/audit-logs`           | View audit logs           |

### Customer Routes (`/escalated/customer/`)

The ticket routes are protected by `customerGuard`. The knowledge base routes are public.

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

Public. No route-group guard applies.

| Method | Path                   | Description               |
| ------ | ---------------------- | ------------------------- |
| GET    | `/config`              | Widget settings (colour, position, greeting, departments, `accepts_metadata`) |
| GET    | `/embed.js`            | Standalone widget script for other sites |
| POST   | `/verification`        | Email a guest a one-time code (`ticket`, `chat` or `lookup`) |
| POST   | `/lookup`              | Find a ticket by reference and proven email; answers fresh grants |
| POST   | `/tickets`             | Create ticket (public). A guest sends `email` plus the code (`verification_id`, `verification_code`) and gets an expiring grant; a host-authenticated `req.user` needs no code. A `requesterId` in the body is ignored. Optional `metadata` |
| GET    | `/tickets/:reference`  | View ticket (`Authorization: Bearer <grant>`) |
| POST   | `/tickets/:reference/replies` | Reply (`Authorization: Bearer <grant>`) |
| GET    | `/kb/search`           | Search KB                 |
| POST   | `/rate/:token`         | Submit CSAT               |

Live chat lives under `/escalated/widget/chat/`. To run the widget on another
site, list that site and load `embed.js` there; see
[Embedding the widget](embedding-the-widget.md).

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

**Newsletters (optional):** NewsletterList, NewsletterListMember, NewsletterTemplate, Newsletter, NewsletterDelivery
