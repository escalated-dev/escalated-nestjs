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

## Errors

An Inertia visit to a screen that ends in 403, 404, 419, 429, 500 or 503 gets
the shared `Escalated/Error` page, props `status` and a generic `message`. An
exception's own message never reaches the page. Full page loads, API clients,
your own routes and other statuses reach your global filters, then Nest's
default handling.

While developing, set the module option `debug: true` (default `false`): a
500 on an Inertia visit then skips the page and goes on to your filters and
Nest's handling, which logs the stack, the way escalated-laravel leaves a 500
to the framework's debug page under `APP_DEBUG`. The other statuses still get
the page. Leave it off in production.

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
| `ui.listUsers({ search, page, perPage })` | | One page of host users for `Admin/Users/Index`, as `{ data, total }`; each user is `{ id, name, email, isAdmin, isAgent }`. Match `search` against name and email. Without it the page renders empty, with a `notice` prop saying why. |
| `ui.updateUserRoles(userId, change)` | | Applies a toggle from `Admin/Users/Index`: `change` has `isAdmin` and/or `isAgent`. Return `false` for an unknown user. Without it the toggles change nothing and flash an error. |

### Host users (`Admin/Users/Index`)

Escalated owns no users, so the users screen reads and changes them through
your app:

```ts
EscalatedModule.forRoot({
  ui: {
    enabled: true,
    listUsers: async ({ search, page, perPage }) => {
      const [rows, total] = await users.findAndCount({
        where: search ? [{ name: ILike(`%${search}%`) }, { email: ILike(`%${search}%`) }] : {},
        order: { isAdmin: 'DESC', isAgent: 'DESC', id: 'ASC' },
        skip: (page - 1) * perPage,
        take: perPage,
      });
      return { data: rows, total };
    },
    updateUserRoles: async (userId, change) => {
      const result = await users.update(userId, change);
      return result.affected === 1;
    },
  },
});
```

escalated-laravel orders admins first, then agents, then by id. The package
applies Laravel's rules before calling `updateUserRoles`: granting admin also
grants agent, revoking agent also revokes admin, and an admin cannot remove
their own admin access (refused before the hook runs).

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

Knowledge base (public, like the `/escalated/customer/kb` JSON routes; off
with `enableKnowledgeBase: false`):

- `GET /escalated/kb` - `Customer/KnowledgeBase/Index` (published articles, 15
  a page, `search` and `category` filters, root categories with published
  `articles_count`)
- `GET /escalated/kb/:slug` - `Customer/KnowledgeBase/Article` (with up to 5
  `related` articles; counts the view); `POST /escalated/kb/:slug/feedback`
  (`helpful`) records helpful / not helpful

Guest (no host user; verified guest access, see docs/guest-access.md):

- `GET /escalated/guest/create` - `Guest/Create` (`verification_url` and
  `lookup_url` are the `/escalated/guest` verification and lookup routes);
  `POST /escalated/guest` files the ticket with the emailed code
  (`verification_id`, `verification_code`) and redirects to its grant
- `GET /escalated/guest/:grant` - `Guest/Show` (the customer ticket payload
  plus `guest_access_expires_at`, and `token`); `POST /:grant/reply` and
  `POST /:grant/rate` (resolved or closed tickets, once). An expired or
  unknown grant is refused with `403`, as the guest JSON routes refuse it

Admin (`adminGuard`):

- `GET /escalated/admin/settings` - `Escalated/Admin/Settings`, with
  `supported_settings` (`show_powered_by`, `widget_color`, `widget_position`,
  `widget_greeting`, `widget_allowed_origins`, the keys this backend stores
  and reads, so the page hides the rest); `POST /escalated/admin/settings`
  saves them
- `GET /escalated/admin/import` - `Admin/Import/Index` (`adapters` from
  `importAdapters`, the 20 newest `jobs`); `/import/:platform/connect` -
  `Admin/Import/Connect` (`POST .../test-connection` answers
  `{success[, error]}`); `/import/:platform/mapping` - `Admin/Import/Mapping`;
  `POST /import/:platform/review` - `Admin/Import/Review` (writes nothing);
  `POST /import/:platform/start` starts the import; `/import/progress/:job` -
  `Admin/Import/Progress`, polled through `GET /import/status/:job`;
  `POST /import/{pause,resume,cancel}/:job`. Credentials never reach a page
- `GET /escalated/admin/workflows` - `Admin/Workflows/Index`;
  `/workflows/create` and `/workflows/:id/edit` - `Admin/Workflows/Form`; the
  builder's `POST`, `PUT`, `DELETE`, `toggle` and `reorder` redirect back to the
  list (see docs/workflows.md for the wire contract)
- `GET /escalated/admin/workflows/logs` - `Admin/Workflows/Logs` (the newest
  100 runs, `?workflow=` for one workflow, with `workflows` to filter by).
  `Admin/Workflows/Builder` is not served: escalated-laravel renders the
  builder inside `Admin/Workflows/Form`, as this package does
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
  and `/statuses/:id/edit` - `Admin/Statuses/Form`. `categories` are
  escalated-laravel's `new`, `open`, `pending`, `on_hold` and `solved`, and
  ticket lifecycle keys off them (see "Status categories" below); a new status
  gets a slug from its label, an edit keeps it, `is_default` is exclusive per
  category, a system status (`is_system`, a built-in slug) keeps its category
  and cannot be deleted, and a status tickets still have cannot be deleted
- `GET /escalated/admin/escalation-rules` - `Admin/EscalationRules/Index`;
  `/escalation-rules/create` and `/escalation-rules/:id/edit` -
  `Admin/EscalationRules/Form`. Rules are escalated-laravel's: `conditions`
  (`[{ field, value }]`: `status` by slug, `priority`, `assigned`,
  `age_hours`, `no_response_hours`, `sla_breached`, `department_id`,
  `ticket_type`, `account`) matched against open tickets, and `actions`
  (`escalate`, `change_priority`, `assign_to`, `change_department`), run by
  the five-minute sweep once per ticket (again after the ticket stops
  matching, or after `repeat_after_hours`). `escalate` moves the ticket to the
  status with slug `escalated` when there is one and sends
  `ticket.escalated`. Rules saved before this show their SLA policy and
  trigger as conditions (`sla_policy_id`, `first_response_breached`,
  `resolution_breached`, `first_response_due_within_minutes`), which saving
  keeps. Categories are not stored (`category` is null)
- Reports, as escalated-laravel's ReportController sends them (`?days=`, and
  `?period=` on the advanced reports; 30 by default):
  `GET /escalated/admin/reports` - `Admin/Reports`; `/reports/dashboard` -
  `Reports/Dashboard`; `/reports/agents` - `Reports/AgentMetrics`;
  `/reports/sla` - `Reports/SlaReport`; `/reports/csat` - `Reports/CsatReport`;
  `/reports/sla-trends` (`group_by` `day`, `week` or `month`) -
  `Reports/SlaTrends`; `/reports/response-times` (also `/reports/frt`) -
  `Reports/ResponseTimes` (target 4 hours); `/reports/resolution-times` (also
  `/reports/resolution`) - `Reports/ResolutionTimes` (target 24 hours);
  `/reports/agent-ranking` - `Reports/AgentRanking`; `/reports/cohorts` -
  `Reports/Cohorts`; `/reports/comparison` - `Reports/Comparison`.
  Times between two timestamps are worked out from the selected tickets rather
  than with each database's date functions, so they are fractional hours on
  every database, and days, ISO weeks and months are UTC. Agents are named by
  `ui.resolveUsers` or their agent profile. Cohort `csat` is the cohorts'
  average rating (Laravel sends 0). `Reports/AgentDetail` is not served:
  escalated-laravel's own props for it do not match the component.
  `GET /escalated/admin/reports/export/:type?format=csv|json` exports
  `tickets`, `agent_performance`, `sla_compliance`, `csat`, `resolution_times`
  or `first_response_times` (served without `ui.enabled` too; each export is
  audit-logged as `report.exported`)
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
- `GET /escalated/admin/custom-fields` - `Admin/CustomFields/Index` (every
  definition by position, with Laravel's keys); `/custom-fields/create` and
  `/custom-fields/:id/edit` - `Admin/CustomFields/Form` (`contexts`: `ticket`,
  `user`, `organization`); `POST /custom-fields/reorder` (`positions`). Ticket
  fields' values are sent as `custom_fields` (by slug) on ticket create and
  update, and shown as `custom_fields` on the ticket pages
- `GET /escalated/admin/custom-objects` - `Admin/CustomObjects/Index` (with
  `records_count`); `/custom-objects/create` and `/custom-objects/:id/edit` -
  `Admin/CustomObjects/Form`; `/custom-objects/:id/records` -
  `Admin/CustomObjects/Records` (newest first), with record create, update and
  delete
- `GET /escalated/admin/roles` - `Admin/Roles/Index` (`users_count` is the
  agents with the role); `/roles/create` and `/roles/:id/edit` -
  `Admin/Roles/Form` (`permissions` grouped by `group`); system roles cannot
  be deleted
- `GET /escalated/admin/api-tokens` - `Admin/ApiTokens/Index` (`users` are the
  active agents; the token itself is never listed). Creating one redirects
  back with the plain token in the `plain_text_token` flash value, shown once
- `GET /escalated/admin/users` - `Admin/Users/Index` (`users` paginated 20 a
  page with `search`, `filters`, `currentUserId`, and `notice`), and
  `PATCH /escalated/admin/users/:user/role` (`role`: `admin`|`agent`,
  `value`), both through the host's `ui.listUsers` / `ui.updateUserRoles`
  (see Host users above)
- `GET /escalated/admin/kb-articles` - `Admin/KnowledgeBase/Articles/Index`
  (`search`, `status`, `category_id` filters, 20 a page);
  `/kb-articles/create` and `/kb-articles/:id/edit` -
  `Admin/KnowledgeBase/Articles/Form` (`body` is the article text; a slug is
  made from the title when empty and must be unique);
  `GET /escalated/admin/kb-categories` - `Admin/KnowledgeBase/Categories/Index`
  (with `articles_count`, `parent_id`, `position`) and its create/update/delete
- The Settings sub-pages, each saving back to itself with a `success` flash:
  `GET`/`POST /escalated/admin/settings/csat` - `Admin/Settings/CsatSettings`
  (stored only; survey sending does not read them yet);
  `/settings/data-retention` - `Admin/Settings/DataRetention` (with
  `purgePreview`; the scheduler applies the periods daily at 03:30 through
  `DataRetentionService`: a closed ticket past its period is deleted with its
  rows, attachment rows and audit logs past theirs are deleted, and so are
  expired guest verification codes; every period defaults to `never`);
  `/settings/email` - `Admin/Settings/EmailSettings` (`email_addresses`,
  `default_reply_address`; stored only, outbound mail does not read them);
  `/settings/public-tickets` - `Admin/Settings/PublicTickets` (`POST` or
  `PUT`, saving the `guest_policy` setting the widget resolves); and
  `GET /settings/database` - `Admin/Settings/DatabaseConnection`, read-only:
  the connection is the module's `connection` option, so `pinnedByConfig` is
  true, `POST /settings/database` is refused with an `error` flash, and
  `POST /settings/database/test` returns the connection's description (422
  for another name). `Admin/Settings/Sandbox` is not served, as in Laravel

On these shared JSON routes, a state-changing browser request (one asking for
HTML) without `X-Inertia` / `X-Requested-With` is refused while the screens
are on; API clients are unaffected.

The pages the frontend ships that no screen serves yet are listed, exactly, in
`NOT_YET_RENDERED` in `test/page-name-parity.spec.ts`. Not yet supported:
attachments on screen replies (multipart), pinned notes, presence and typing,
side conversations and ticket links from the admin ticket screen, saved-view
reordering.

## Status categories

Every ticket status belongs to one of escalated-laravel's categories: `new`,
`open`, `pending`, `on_hold` or `solved` (`TicketStatus.category`). Lifecycle
reads the category, so a status an admin adds behaves like the built-in one
of its category:

- Moving a ticket to a `solved` status stamps `resolvedAt` and `closedAt`,
  which stops SLA timers and escalation, counts it as resolved in reports and
  leaves it out of open queues. Guests cannot reply to it and can rate it,
  and a customer's close takes the `closed` status or else the first solved
  one, while reopening never picks a solved default. The event is `ticket.resolved` for the
  `resolved` slug and `ticket.closed` for any other solved status.
- The other four categories are open. This backend has no "waiting on
  customer" behaviour of its own, so `pending` and `on_hold` only label the
  wait: SLA timers keep running.
- `isClosed` stays on the table, equal to `category === 'solved'`. Rows
  written without a category (host seeders from before the column) take one
  from `isClosed` and the slug: `resolved`/`closed` are solved,
  `waiting_on_customer`/`pending` pending, `snoozed` on hold, and the rest
  open.
- Every status change takes a status by slug or id and goes through
  `TicketService.update`: the agent API (`statusId`), the screen actions and
  bulk action (`status`/`value`), macros (`status`), workflows and automations
  (`change_status`). Each sends `ticket.status_changed` and the lifecycle
  event the new status implies.
- New tickets get the default status. Defaults are exclusive per category, so
  when more than one category has one, the earliest category wins (`new`,
  then `open`, ...).
- Changing a status's category does not touch tickets that have it.
- Agent and admin ticket JSON carries `status_category`, and `custom_status`
  (`{ id, label, slug, color, category }`) for a non-system status. Customer
  and guest views show the status slug as before, plus `status_category`.
