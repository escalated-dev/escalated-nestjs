# Agent panel data

What this package sends the shared frontend's agent panel beyond the ticket
pages' required props. The contract is ADR
[2026-11-05-agent-panel-data](https://github.com/escalated-dev/escalated-developer-context/blob/main/decisions/2026-11-05-agent-panel-data.md)
in escalated-developer-context; escalated-laravel is the reference
implementation. Everything here is optional: an older frontend ignores it.

Run the `AgentPanelData1793664000000` migration (exported from the package)
before upgrading, or let `synchronize` create the schema in development.

## The agent's own status

| Route | Name | Body | Answer |
|---|---|---|---|
| `PUT` or `POST /escalated/agent/status` | `escalated.agent.status` | `{ "status": "online" \| "away" \| "offline" }` | `{ "agent_status": "away" }` (JSON request); back (Inertia visit); 422 for any other value |

The status lives in the agent profile (`escalated_agent_profiles.chatStatus`,
created for an agent who has no profile yet). Live-chat routing reads the
profile's `isAvailable`, which is kept equal to `chatStatus === 'online'`, so
an Away or Offline agent gets no new chats. This package never had an admin
live-chat status route, so there is no alias to keep.

Agents get `escalated.agent_status` (`offline` until they set one) and
`escalated.agent_statuses` (`["online", "away", "offline"]`) in the shared
props. Customers get neither. No event is emitted.

## Knowledge-base search

`GET /escalated/agent/kb/search?q=...` (`escalated.agent.kb.search`).

- `q`: 2 to 200 characters; `limit`: 1 to 20, default 10. Anything else is a 422.
- Answer: `{ "data": [{ "id", "title", "excerpt", "url", "category": { "id", "name" } | null, "updated_at" }] }`.
  `excerpt` is the article as plain text, cut at about 160 characters; `url`
  is the absolute URL of the article on the customer knowledge base
  (`escalated.customer.kb.show`), or `null` while the screens are off.
- Published articles only; this package has no agent-only articles.
- Case-insensitive `LIKE` on title and body with `%` and `_` taken literally;
  title matches first, then the most recently updated.
- 404 while `enableKnowledgeBase` is `false`. Needs `kb.view` under roles &
  permissions.

The same escaping now applies to the widget's article search and the
knowledge-base screens.

## Unread tickets

- **Customer activity** is the ticket's `lastCustomerActivityAt`: set when the
  ticket is created through `TicketService.create` and on every public reply
  or chat message from the requester or a guest. Agent replies, internal
  notes and system replies never move it. Tickets that existed before the
  migration have none, so they start out read.
- **Read markers** live in `escalated_ticket_reads` (`userId`, `ticketId`,
  `lastReadAt`), one row per agent and ticket; a null `lastReadAt` means the
  agent marked the ticket unread. They go with the ticket.
- Opening a ticket in the agent panel (`escalated.agent.tickets.show`, the
  screen) marks it read. The JSON API and admin screens do not.

| Route | Name | Answer |
|---|---|---|
| `POST /escalated/agent/tickets/{ticket}/read` | `escalated.agent.tickets.read` | `{ "is_unread": false }`, or back |
| `POST /escalated/agent/tickets/{ticket}/unread` | `escalated.agent.tickets.unread` | `{ "is_unread": true }`, or back |
| `POST /escalated/agent/tickets/bulk` | `escalated.agent.tickets.bulk` | the bulk actions, plus `mark_read` and `mark_unread` (no `value`) |

`escalated.agent.tickets.bulk` is new here (the agent list had no bulk route);
it takes the admin list's actions too. The admin bulk route also takes
`mark_read` / `mark_unread`. Each acts only on tickets the agent can see and
needs only `ticket.view` for the markers.

Props: `is_unread` on every row of `tickets.data` (TicketIndex) and on
`ticket` (TicketShow, always `false`), and `inbox.unread`
(`{ mine, unassigned, all }`, the open tickets in each queue that are unread).

## Customer online status

- `requester_online` and `requester_last_seen_at` on every row of
  `tickets.data` and on `ticket` (TicketShow), from one query per page.
- The customer is the ticket's requester; for a guest, its contact; for a
  guest with neither (a widget chat), the ticket itself.
- Last-seen is written into `escalated_customer_presence` from requests the
  customer already makes: the customer ticket API and screens (agents with a
  profile are not recorded), the widget chat (start, messages, typing, end,
  rate) and the widget's ticket lookup. A row is written at most once every
  30 seconds, by a conditional `UPDATE`, so it holds across processes.
- Online means seen within `presence.onlineWindowSeconds` (default 120).

No customer, guest, widget or API response carries these fields. There is no
widget heartbeat.

## Notifications

In-app notifications for agents, in `escalated_notifications`. On by default;
`agentNotifications: false` turns the feed off (the routes answer 404 and the
shared prop is left out).

| `type` | Sent to | When |
|---|---|---|
| `ticket_assigned` | the new assignee | `ticket.assigned`, unless they assigned it themselves |
| `ticket_reply` | the assignee and followers | a public reply from the customer side |
| `mention` | the mentioned agent | an @mention in an agent's reply or internal note, unless they wrote it |
| `sla_warning` | the assignee | `sla.warning` |
| `sla_breached` | the assignee | `sla.breached` |
| `chat_transferred` | the receiving agent | `chat.transferred`, unless they transferred it to themselves |

@mentions are escalated-laravel's two forms: `@{Full Name}` (what the
composer's picker inserts) and `@name`. A name matches an active agent profile
by its name (from `ui.resolveUsers` when given, else `displayName`) or email,
ignoring case. A customer's reply mentions nobody. The picker searches agents
at `GET /escalated/admin/agents/search?q=` (`escalated.admin.agents.search`,
admin routes, `ticket.view`): up to 10 `{ id, name, email }` whose name or
email contains `q`. There is no mentions table: the notification is the
record.

| Route | Name | Answer |
|---|---|---|
| `GET /escalated/agent/notifications` | `escalated.agent.notifications.index` | `{ data, meta: { current_page, last_page, per_page, total }, unread_count }`, newest first; `?page=`, `?per_page=` (default 20, max 50), `?unread=1` |
| `POST /escalated/agent/notifications/{id}/read` | `escalated.agent.notifications.read` | `{ unread_count }`; 404 for another user's notification |
| `POST /escalated/agent/notifications/read-all` | `escalated.agent.notifications.read-all` | `{ unread_count: 0 }` |

An item is `{ id, type, title, body, ticket: { id, reference, subject } | null, url, created_at, read_at }`.
Titles are English. `body` is the ticket's current subject and `url` its agent
page (a path). When the agent can no longer see the ticket (visibility,
department, or the ticket was deleted) the item stays, but `ticket`, `url` and
`body` are `null` and the title is generic.

Agents get `escalated.notifications: { unread_count }` in the shared props.
With `enableWebsockets`, each new item is emitted as `notification.created`
to the agent's own sockets in their `agent:{id}` room (joined with
`join:agent`), redacted for that agent. The routes are personal and need no
permission under roles & permissions. Muting types per agent is not built.
