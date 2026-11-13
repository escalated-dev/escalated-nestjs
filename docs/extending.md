# Events and extension points

## Events

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

Events: `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_STATUS_CHANGED`, `TICKET_RESOLVED`, `TICKET_CLOSED`, `TICKET_REOPENED`, `TICKET_ASSIGNED`, `TICKET_UNASSIGNED`, `TICKET_ESCALATED`, `TICKET_PRIORITY_CHANGED`, `TICKET_DEPARTMENT_CHANGED`, `TICKET_TAG_ADDED`, `TICKET_TAG_REMOVED`, `TICKET_REPLY_CREATED` (every reply, internal notes included), `NOTE_CREATED` (internal notes), `TICKET_MERGED`, `TICKET_SPLIT`, `SLA_WARNING`, `SLA_BREACHED`, `CHAT_STARTED`, `CHAT_ASSIGNED`, `CHAT_TRANSFERRED`, `CHAT_MESSAGE`, `CHAT_ENDED`, `TICKET_CUSTOM_ACTION_TRIGGERED`. Unassigning a ticket emits `TICKET_UNASSIGNED`, not `TICKET_ASSIGNED`. `CHAT_ACCEPTED` is deprecated and still emitted beside `CHAT_ASSIGNED`.

`sla.warning` fires once per deadline that falls due within `slaWarningMinutes` (default `30`, `0` turns it off). `ticket.escalated` fires the first time each escalation rule matches a ticket. Existing installations run the exported `SlaWarningFlags1792540800000` migration, which adds the warning flags to tickets.

Escalated registers `EventEmitterModule` with `wildcard: true` and the `.` delimiter, so a listener can use a pattern such as `@OnEvent('escalated.ticket.*')`. A listener name that contains `*` is treated as a pattern; names without `*` match exactly, as before.

### Outbound webhooks

Webhooks managed under `/escalated/admin/webhooks` receive the shared event vocabulary (escalated-developer-context ADR 2026-10-21, exported as `CANONICAL_EVENTS`): `ticket.created`, `ticket.updated`, `ticket.status_changed`, `ticket.resolved`, `ticket.closed`, `ticket.reopened`, `ticket.assigned`, `ticket.unassigned`, `ticket.escalated`, `ticket.priority_changed`, `ticket.department_changed`, `ticket.tag_added`, `ticket.tag_removed`, `reply.created`, `note.created`, `sla.warning`, `sla.breached`, `chat.started`, `chat.assigned`, `chat.transferred`, `chat.message` and `chat.ended`, plus `ticket.merged` and `ticket.split`. Each is a JSON `POST` signed with `X-Escalated-Signature` (HMAC-SHA256 of the body with the webhook's secret). Subscribe to `*` for all of them. Chat payloads carry `chat: { session_id, ticket_id, status, agent_id, department_id, ... }`, never the visitor's token or email.

Names from earlier releases are read as their canonical name (`LEGACY_EVENT_NAMES`): a subscription stored as `ticket.reply_created` or `ticket.replied` receives `reply.created`, `ticket.tagged` receives `ticket.tag_added`, and so on. Saving a webhook stores canonical names. Workflows saved with a legacy trigger keep running.

A webhook URL must use `http` or `https` and must resolve only to public addresses. Loopback, private, link-local (including cloud metadata) and reserved targets are refused when the webhook is saved (`400`) and checked again before every delivery attempt. Redirects are not followed.

## Ticket subjects

A ticket has a **requester** (the person who raised it) and a **subject line**
(free text). Sometimes a ticket is also *about* one or more host-app entities —
a Project, a Customer, an asset — that are not people. Attach them as ticket
**subjects** so agents see what the ticket concerns and can jump straight to it
in your app.

Implement the `TicketSubject` contract on any host model you want attachable:

```typescript
import { TicketSubject } from '@escalated-dev/escalated-nestjs';

export class Project implements TicketSubject {
  ticketSubjectTitle(): string {
    return this.name;
  }

  ticketSubjectSubtitle(): string | null {
    return `Project · ${this.customer.name}`;
  }

  ticketSubjectUrl(): string | null {
    return `/projects/${this.id}`;
  }

  ticketSubjectColor(): string | null {
    return '#2563eb';
  }

  ticketSubjectIcon(): string | null {
    return 'folder';
  }
}
```

Register an allowlist and optional resolver when importing the module. NestJS
does not own your host models — the resolver maps a stored `type` + `id` to a
`TicketSubject` for API serialization:

```typescript
EscalatedModule.forRoot({
  ticketSubjects: {
    types: ['Project', 'Customer'],
    resolver: async (type, id) => {
      if (type === 'Project') return projectRepo.findOne({ where: { id } });
      if (type === 'Customer') return customerRepo.findOne({ where: { id } });
      return null;
    },
  },
});
```

Each attached subject is serialized on the ticket as:

```json
{
  "type": "Project",
  "id": "7",
  "role": "project",
  "title": "Acme Redesign",
  "subtitle": "Project · Acme",
  "url": "/projects/7",
  "color": "#2563eb",
  "icon": "folder",
  "missing": false
}
```

`subjectId` is stored as a string so integer, UUID, or string-keyed host models
all work. When the resolver is absent or returns null, `title` falls back to
`type#id`, presentation fields are null, and `missing` is `true`.

Agent API (types must be allowlisted):

- `POST /escalated/agent/tickets/:id/subjects` — body `{ type, id, role? }`
- `DELETE /escalated/agent/tickets/:id/subjects/:linkId`

Programmatic attach via `TicketSubjectService` works for any type when the
allowlist is empty; the agent API only accepts allowlisted types.

## Custom Ticket Actions

Host applications can add custom buttons to the agent ticket screen and handle
clicks with normal event listeners. Register actions when importing the module:

```typescript
EscalatedModule.forRoot({
  ticketActions: {
    actions: [
      {
        key: 'sync-crm',
        label: 'Sync CRM',
        variant: 'primary',
        confirmation: 'Sync this ticket to the CRM?',
        metadata: { icon: 'refresh-cw' },
      },
    ],
  },
});
```

`label`, `visible`, `enabled`, `confirmation`, and `metadata` may each be a
value or a `(ticket, user) => value` function for dynamic behavior. For richer
logic you can instead provide an object implementing the `TicketAction`
interface (`key()`, `label()`, `visible()`, `enabled()`, `variant()`,
`confirmation()`, `metadata()`).

The agent ticket show response exposes the visible actions as `customActions`
(each with a `url` and `method`). When the agent triggers one
(`POST /escalated/agent/tickets/:id/actions/:actionKey`), Escalated dispatches
`TicketCustomActionTriggered`:

```typescript
import { OnEvent } from '@nestjs/event-emitter';
import {
  ESCALATED_EVENTS,
  TicketCustomActionTriggeredEvent,
} from '@escalated-dev/escalated-nestjs';

@Injectable()
export class CrmSyncListener {
  @OnEvent(ESCALATED_EVENTS.TICKET_CUSTOM_ACTION_TRIGGERED)
  handle(event: TicketCustomActionTriggeredEvent) {
    if (event.action !== 'sync-crm') return;
    // event.ticket, event.userId, event.payload, event.metadata
  }
}
```

The event exposes `ticket`, `action`, `userId`, `payload`, and `metadata`.
Escalated also records an internal note on the ticket whenever an action fires,
for auditability.

## Real-time Updates

Enable WebSocket broadcasting for live ticket updates:

```typescript
EscalatedModule.forRoot({
  enableWebsockets: true,
  // Who is connecting: return the host user id, or null for a guest.
  websocketAuth: async (socket) => verifyMyToken(socket.handshake.auth.token),
  // Agent rooms, the chat queue and internal notes need confirmed roles.
  ticketAccess: { resolveUser: async (id) => ({ id, isAgent: true, isAdmin: false }) },
});
```

Every connection must identify a host user or present a guest token
(`auth.guestToken`, the ticket's guest access token, or `auth.chatToken`, the
widget chat visitor token); anything else is disconnected. Without
`websocketAuth`, `userResolver(handshakeRequest)` or a `user` set on the
handshake request by your socket middleware is used. New tickets, queue, SLA and
assignment events go to agents only, internal notes never reach guest or
customer sockets, and guest tokens are never broadcast.

Plugins broadcast through the same gateway with `ctx.broadcast`: `toUser`
reaches that user's sockets, `toTicket` the sockets in the ticket's room that
may see it, and `toChannel(name, ...)` the sockets that sent
`join:plugin` with `{ channel: name }` (any connection may join; `leave:plugin`
leaves).

Client-side (Socket.IO):

```javascript
const socket = io('/escalated', { auth: { token } });
socket.emit('join:ticket', { ticketId: 1 });
socket.on('ticket:updated', (data) => console.log('Updated:', data));
socket.on('ticket:reply', (data) => console.log('New reply:', data));
```
