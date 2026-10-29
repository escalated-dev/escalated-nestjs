# Plugins

Plugins built with [`@escalated-dev/plugin-sdk`](https://github.com/escalated-dev/escalated-plugin-sdk)
run inside this package, in your Nest process. The behaviour every Escalated
backend shares is in the
[plugin contract](https://github.com/escalated-dev/escalated-developer-context/blob/main/domain-model/plugin-contract.md);
this page covers what is specific to NestJS.

## Installing a plugin

Installing is a deployment, not an upload. Add the package and pass its
`definePlugin()` object to the module:

```ts
import slack from '@escalated-dev/plugin-slack';
import { definePlugin } from '@escalated-dev/plugin-sdk';

const crm = definePlugin({
  name: '@acme/escalated-plugin-crm',
  version: '1.0.0',
  pages: [{ route: 'settings', component: 'CrmSettings' }],
  endpoints: {
    'GET /CrmSettings': async (ctx) => ({ api_key: (await ctx.config.get('api_key')) ? 'set' : 'unset' }),
  },
});

EscalatedModule.forRoot({ plugins: [slack, crm] });
```

Each plugin then appears in **Admin > Plugins** (`/escalated/admin/plugins`),
inactive. Nothing in it runs until an admin activates it. The screen has no
upload button (`can_upload: false`); the delete button uninstalls, which
deactivates the plugin and forgets its activation but keeps its stored data and
leaves it listed, because its code is still in your build.

A plugin's slug is its name without the leading `@` and with `/` as `--`
(`@acme/escalated-plugin-crm` is `acme--escalated-plugin-crm`). Two plugins
with one slug, or a malformed plugin, stop the module at boot.

Run the `Plugins1793318400000` migration first. It creates
`escalated_plugins` (activation) and `escalated_plugin_store` (what
`ctx.store` and `ctx.config` keep).

## What a plugin gets

| Plugin declares | Served at | Who |
|---|---|---|
| `pages` | `GET /escalated/admin/plugins/{slug}/{route}`, rendered as `Escalated/Plugin/Page` with the props of the plugin's `GET /{component}` endpoint | `adminGuard`, plus the page's `capability` |
| `endpoints` | `/escalated/api/plugins/{slug}{path}` | `adminGuard`, plus the endpoint's `capability` |
| `webhooks` | `/escalated/webhooks/plugins/{slug}{path}` | Anyone. The plugin must authenticate the sender. |
| `onActivate`, `onDeactivate` | Called when an admin activates or deactivates it | |
| `actions` | The canonical events, `plugin.activated`, `plugin.deactivated`, `plugin.uninstalling`, and whatever active plugins `ctx.emit` | |
| `filters` | `PluginRegistry.applyFilters(hook, value)`, for host code that wants a filter point | |
| `pages[].menu`, `components`, `widgets` | Shared with every screen as `escalated.plugins` (`menuItems`, `pageComponents`, `dashboardWidgets`) | Viewers who hold the item's `capability`; admin menu items for admins only |

Only active plugins answer; anything else is a 404.

- A `capability` is a permission slug. A user holds it when their agent role
  has that permission, or their role is `admin`, as `PermissionsGuard` decides.
- Endpoint calls that change state (anything but GET, HEAD and OPTIONS) must be
  sent by a page script, with `X-Requested-With` or `X-Inertia`. A plain
  cross-site form cannot set those, so it cannot use an admin's session.
- Handlers receive the SDK's request: `params` from `:name` segments of the
  declared path, `query`, the parsed `body`, and lowercase `headers` without
  `Cookie`, `Authorization`, `X-XSRF-TOKEN`, `X-CSRF-TOKEN` or `Proxy-*`.
- For webhooks that check a signature, create the app with
  `NestFactory.create(AppModule, { rawBody: true })`; the exact bytes then
  arrive as `req.rawBody`. Without it there is no `rawBody`.
- Return a value for a JSON 200, or the SDK's `httpResponse()` for another
  status, text, or headers. A malformed envelope is a 502. A handler that
  throws is a 500 whose body says nothing about the error; the error goes to
  the `EscalatedPlugins` log.
- Timeouts: actions and endpoints 30 s, filters 5 s, webhooks 60 s.

## Events

Every canonical event (`ticket.created`, `reply.created`, `ticket.status_changed`
and the rest of ADR 2026-10-21) reaches active plugins' `actions` under that
name, after the change is written. Merged and split tickets, which are not in
the shared vocabulary, are not delivered, and legacy names never are. A plugin
action that throws or takes longer than 30 s is logged; the request that
caused the event is not affected.

The payload carries the subject flat and under its own key, because the
official plugins read both:

- ticket events: the ticket (`id`, `reference`, `subject`, `title`,
  `description`, `status` (slug), `status_id`, `priority`, `channel`,
  `ticket_type`, `department_id`, `requester_id`, `contact_id`,
  `assigned_to`, `metadata`, `tags`, `created_at`, `updated_at`) plus
  `ticket`, and the event's extras: `old_status`/`new_status`,
  `agent_id`/`previous_agent_id`, `old_priority`/`new_priority`,
  `old_department_id`/`new_department_id`, `tag`, `changes`, `reason`;
- `reply.created` and `note.created`: the reply (`id`, `ticket_id`, `body`,
  `type`, `is_internal`, `user_id`, `created_at`, `updated_at`) plus `reply`
  and `ticket`;
- `sla.warning` and `sla.breached`: the ticket plus `ticket` and `type`;
- `chat.*`: `{ session }`.

## The context

Everything in `ctx` is scoped to the plugin's name.

- `ctx.store.query` filters in this process: equality (an array field matches
  when it contains the value), `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`,
  `$nin`, on dotted field names; `orderBy` (numbers, then strings), `order`,
  `limit`. A field name that is not a dotted path is an error.
- `ctx.emit` fires an action to the active plugins. The canonical event names
  and the `plugin.*` lifecycle names belong to the host and are dropped.
- `ctx.tickets` and `ctx.replies` go through `TicketService` and
  `ReplyService`, so what a plugin writes fires the same events as anything
  else. `create` takes `subject` (or `title`), `description` (or `body`),
  `priority`, `status` (a slug), `department_id`, `ticket_type`, `channel`
  (default `api`), `metadata`, and `contact_id` or
  `requester_email`/`requester_name`; `update` takes the same minus the
  requester. A plugin never picks who it acts as: that is the signed-in user
  of the request it serves, or nobody (0). `query` filters on `id`,
  `reference`, `status`, `priority`, `channel`, `ticket_type`,
  `department_id`, `requester_id`, `contact_id`, `assigned_to` (replies:
  `ticket_id`, `is_internal`, `type`), at most 500 rows; any other key is an
  error. `ctx.replies.create` needs `ticket_id` and `body`, and
  `is_internal: true` makes a note.
- `ctx.contacts` are Escalated's contacts (found or created by email), not
  your users. `ctx.agents` reads agent profiles: `id` is the user id, `name`
  the display name, and `email` is null because the package does not hold it.
- `ctx.broadcast` goes through the Socket.IO gateway (`enableWebsockets`), as
  event `event` with payload `data`, guest tokens stripped, with the audiences
  of escalated-laravel's channels: `toChannel(channel, ...)` reaches sockets
  that sent `join:plugin` with `{ channel }` (open to any connection, like
  Laravel's public `plugin.{channel}`), `toUser(userId, ...)` that user's own
  sockets, `toTicket(ticketId, ...)` sockets in the ticket's room that may see
  it. Without the gateway it does nothing. A missing channel, user, ticket or
  event is an error.

## Trust

A plugin runs in your process with your process's privileges. Only install
plugins you would merge into your own code. There is no tenant mode in this
package, so there is nothing more to isolate.
