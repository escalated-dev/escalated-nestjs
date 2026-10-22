# The shared screens (Inertia UI)

Every Escalated backend can serve the shared Vue 3 + Inertia screens from
[`@escalated-dev/escalated`](https://github.com/escalated-dev/escalated) for
agents, customers and admins, or run headless (API only). See
escalated-developer-context `guides/ui-optional-pattern.md`.

In this package the screens are **off by default** (`ui.enabled: false`), so
an existing API-only host is unchanged: no page routes are registered and every
response stays JSON. escalated-laravel defaults to on; this default will flip
to `true` in a future minor release, so set it explicitly either way.

## Turning it on

```ts
EscalatedModule.forRoot({
  agentGuard: AgentGuard,
  adminGuard: AdminGuard,
  customerGuard: CustomerGuard,
  ui: {
    enabled: true,
    scripts: ['/build/escalated.js'], // your Vue + Inertia entry
    styles: ['/build/escalated.css'],
    version: () => manifestHash(), // optional asset version
  },
});
```

Your entry mounts the shared pages with Inertia:

```js
import { createInertiaApp } from '@inertiajs/vue3';
import { EscalatedPlugin, resolveEscalatedPage } from '@escalated-dev/escalated';

createInertiaApp({
  resolve: (name) => resolveEscalatedPage(name),
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) }).use(plugin).use(EscalatedPlugin).mount(el);
  },
});
```

## The Inertia protocol

- A browser navigation (`Accept: text/html`) gets an HTML document from the
  root view, with the page object in `<script data-page="app">` (Inertia 3) and
  in `<div id="app" data-page>` (Inertia 1 and 2).
- An Inertia visit (`X-Inertia: true`) gets the page object as JSON with
  `X-Inertia: true` and `Vary: X-Inertia`.
- An Inertia `GET` whose `X-Inertia-Version` differs from `ui.version` gets
  `409` with `X-Inertia-Location`, and the client reloads.
- Partial reloads (`X-Inertia-Partial-Component`, `-Data`, `-Except`) send
  only the requested props, plus `errors`.
- A form posted by a screen is answered with a `303` redirect back to the page
  it came from (the same-origin `Referer`), with a flash message. Invalid input
  goes back with `errors` per field, which `useForm` shows by its inputs.
  Flash data rides in a short-lived `escalated_flash` cookie, because
  Escalated owns no session.

Routes that are both a JSON API route and a screen (`GET
/escalated/agent/tickets`, `GET /escalated/agent/tickets/:id`) answer with the
screen only for an Inertia visit or a browser navigation. API clients, which
ask for JSON or anything, get the JSON they always got.

## Shared props

Every page gets, like Laravel's `HandleInertiaRequests` plus
`EscalatedServiceProvider::shareInertiaData`:

| Prop | Value |
|---|---|
| `auth.user` | `{ id, name, email }` from `userResolver(req)` or `req.user`, or `null` |
| `flash` | `{ success, error, ... }` from the last form |
| `errors` | field errors from the last form |
| `escalated` | `prefix` (`escalated`), `is_agent`, `is_admin`, `permissions`, `features`, `broadcasting`, knowledge base flags, `show_powered_by`, `agent_type` |
| `ziggy` | the named routes, in the shape ziggy-js reads |

`is_admin` / `is_agent` come from `ticketAccess.resolveUser` when it is
configured, otherwise from asking your `adminGuard` / `agentGuard`. Add your
own shared props with `ui.share(req)`.

## Options

| Option | Default | |
|---|---|---|
| `ui.enabled` | `false` | Serve the screens. |
| `ui.rootView(page, req)` | built in | Return the HTML document for a first visit. Use it for your own layout, CSP nonces or SSR. |
| `ui.version` | `''` | Asset version, a string or a function. |
| `ui.title`, `ui.scripts`, `ui.styles`, `ui.head` | | Used by the default root view. |
| `ui.share(req)` | | Extra shared props. |
| `ui.resolveUsers(ids)` | | Host user names and emails for the screens. Without it they show contact names, agent display names or `User #id`. |

## `route()`

The shared components call Laravel's Ziggy `route(name, params)`. The default
root view installs a compatible helper built from the `ziggy` prop (an unknown
name warns and links to `#`). With a custom root view, either put the
exported `ROUTE_HELPER` script in your document or use ziggy-js with
`page.props.ziggy`. The default view's inline script needs
`script-src 'unsafe-inline'` or a nonce; under a strict CSP, use `rootView`.

## Forms and cross-site requests

Escalated does not own your session or CSRF tokens. Screen forms are sent by
the Inertia client, which adds `X-Inertia`; the screens' own `POST` routes
refuse requests without `X-Inertia` or `X-Requested-With`, which another site
cannot send with your users' cookies without a CORS preflight. Keep your
session cookie `SameSite=Lax` or stricter, and keep CORS closed on these paths.

## What is served

Agent (`agentGuard`):

- `GET /escalated/agent` - `Escalated/Agent/Dashboard`
- `GET /escalated/agent/tickets` - `Escalated/Agent/TicketIndex` (Laravel's
  filter names: `status`, `priority`, `department_id`, `assigned_to`,
  `unassigned`, `search`, `sla_breached`, `tag_ids`, `following`, `sort_by`,
  `sort_dir`, `per_page`)
- `GET /escalated/agent/tickets/:ticket` - `Escalated/Agent/TicketShow` (by
  reference or id)
- `POST /escalated/agent/tickets/:ticket/` `reply`, `note`, `assign`
  (`agent_id`), `status` (a status slug), `priority`, `tags` (`tag_ids`),
  `department` (`department_id`), `macro` (`macro_id`), `follow`, and
  `actions/:action` (custom ticket actions)

Customer (`customerGuard`):

- `GET /escalated` and `GET /escalated/customer/tickets` -
  `Escalated/Customer/Index` (the customer's own tickets; filters `status`,
  `priority`, `ticket_type`, `search`, `sort_by`, `sort_dir`)
- `GET /escalated/create` - `Escalated/Customer/Create`; `POST /escalated`
  creates the ticket and redirects to it
- `GET /escalated/customer/tickets/:ticket` - `Escalated/Customer/Show`
  (Laravel's allow-listed requester payload: no internal notes, no assignee)
- `POST /escalated/customer/tickets/:ticket/` `reply`, `close`, `reopen`,
  `rate`

Admin (`adminGuard`):

- `GET /escalated/admin/settings` - `Escalated/Admin/Settings`, with
  `supported_settings` (`show_powered_by`, `widget_color`, `widget_position`,
  `widget_greeting`, `widget_allowed_origins`, the keys this backend stores
  and reads, so the page hides the rest); `POST /escalated/admin/settings`
  saves them
- `GET /escalated/admin/workflows` - `Admin/Workflows/Index`;
  `/workflows/create` and `/workflows/:id/edit` - `Admin/Workflows/Form`; the
  builder's `POST`, `PUT`, `DELETE`, `toggle` and `reorder` redirect back to the
  list (see docs/workflows.md for the wire contract)
- `GET /escalated/admin/departments` - `Admin/Departments/Index` (with
  `tickets_count`, `agents_count`); `/departments/create` and
  `/departments/:id/edit` - `Admin/Departments/Form`
- `GET /escalated/admin/tags` - `Admin/Tags/Index` (with `tickets_count`)
- `GET /escalated/admin/tickets` - `Admin/Tickets/Index` (the agent list's
  filters, plus `agents` and the admin's own and shared `savedViews`);
  `GET /escalated/admin/tickets/:reference` - `Admin/Tickets/Show` (with
  `agents` and `is_snoozed`); its `reply`, `note`, `assign`, `status`,
  `priority`, `tags`, `department`, `macro`, `follow`, `snooze` and `unsnooze`
  actions redirect back to the ticket; `POST /escalated/admin/tickets/bulk`
  (`ticket_ids`, `action` of `status`/`priority`/`assign`/`department`/`tags`/
  `delete`, `value`) redirects back to the list; `POST`/`PUT`/`DELETE
  /escalated/admin/saved-views` serve the views sidebar (JSON, own views only)
- `GET /escalated/admin/sla-policies` - `Admin/SlaPolicies/Index` (targets
  shown in hours, with `tickets_count`); `/sla-policies/create` and
  `/sla-policies/:id/edit` - `Admin/SlaPolicies/Form` (`priorities`: `low`,
  `medium`, `high`, `urgent`). Hours are stored as minutes;
  `business_hours_only` keeps the policy's business schedule or takes the
  default one, and is refused when there is none
- `GET /escalated/admin/statuses` - `Admin/Statuses/Index`; `/statuses/create`
  and `/statuses/:id/edit` - `Admin/Statuses/Form`. `categories` is `open` and
  `solved`, the distinction this backend stores (`isClosed`); a new status
  gets a slug from its label, an edit keeps it, and a status tickets still
  have cannot be deleted. Status descriptions are not stored
- `GET /escalated/admin/macros` - `Admin/Macros/Index` (every macro with its
  `creator`); the screen's action names (`status` by slug, `priority`,
  `assign`, `tags`, `department`, `reply`, `note`) now run when a macro is
  applied, beside the older `set_*` / `add_*` names
- `GET /escalated/admin/canned-responses` - `Admin/CannedResponses/Index`
  (`body` is the response text; `category` is not stored and is `null`; a new
  response gets a short code from its title)
- `GET /escalated/admin/webhooks` - `Admin/Webhooks/Index` (with the latest
  delivery and `deliveries_count`); `/webhooks/create` and
  `/webhooks/:id/edit` - `Admin/Webhooks/Form` (`availableEvents` are the names
  webhooks are sent under); `/webhooks/:id/deliveries` -
  `Admin/Webhooks/DeliveryLog` (paginated); `POST
  /webhooks/deliveries/:delivery/retry` sends a delivery again now

On these shared JSON routes, a state-changing browser request (one asking for
HTML) without `X-Inertia` / `X-Requested-With` is refused while the screens
are on; API clients are unaffected.

The pages the frontend ships that no screen serves yet are listed, exactly, in
`NOT_YET_RENDERED` in `test/page-name-parity.spec.ts`. Not yet supported:
attachments on screen replies (multipart), pinned notes, presence and typing,
side conversations and ticket links from the admin ticket screen, saved-view
reordering.
