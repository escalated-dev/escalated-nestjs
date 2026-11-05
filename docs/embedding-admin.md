# Embedding the admin in your own admin panel (optional)

Escalated ships a standalone admin at `/escalated/admin`, with its own sidebar
and top bar. **That is the default, and it needs no setup.** If your NestJS
app already has an admin panel, you can instead show Escalated's admin screens
inside it: under your sidebar and header, your URL prefix, and your guards and
middleware.

This is an optional alternative to the standalone admin. Nothing on this page
has any effect until you turn it on: with no `ui.embed` configuration every
route, guard, page, prop, header and root view is exactly what it was before
(a test compares the whole route table against a snapshot taken before the
feature existed). The design is in the ADR
[`2026-11-05-embeddable-admin`](https://github.com/escalated-dev/escalated-developer-context/blob/main/decisions/2026-11-05-embeddable-admin.md);
the frontend side is documented in
[`@escalated-dev/escalated` docs/embedding-admin.md](https://github.com/escalated-dev/escalated/blob/main/docs/embedding-admin.md).

Embedding needs the screens on (`ui.enabled: true`, see [ui.md](ui.md)).

## Contents

- [Pick your setup](#pick-your-setup)
- [Turning it on](#turning-it-on)
- [Configuration reference](#configuration-reference)
- [What changes, and what does not](#what-changes-and-what-does-not)
- [1. Vue + Inertia host](#1-vue--inertia-host)
- [2. Server-rendered host](#2-server-rendered-host)
- [3. iframe](#3-iframe)
- [The admin menu: `escalated.navigation`](#the-admin-menu-escalatednavigation)
- [Security](#security)
- [What does not move](#what-does-not-move)
- [Turning it off](#turning-it-off)

## Pick your setup

| Your admin panel | Use | `mode` |
|---|---|---|
| Vue + Inertia in this app | [Vue + Inertia host](#1-vue--inertia-host) | `layout` |
| Server-rendered templates (Handlebars, EJS, Pug, template strings, ...) | [Server-rendered host](#2-server-rendered-host) (your template as the root view) | `layout` |
| Another app or origin, a non-Vue SPA, a CMS admin | [iframe](#3-iframe) | `iframe` |

## Turning it on

Pass `ui.embed` to `EscalatedModule.forRoot()`. `embedAdmin()` fills in the
defaults, turns `enabled` on and checks the settings at boot:

```ts
import { Module } from '@nestjs/common';
import { EscalatedModule, embedAdmin } from '@escalated-dev/escalated-nestjs';
import { AdminGuard, AgentGuard, CustomerGuard, BackOfficeGuard } from './auth';

@Module({
  imports: [
    EscalatedModule.forRoot({
      adminGuard: AdminGuard, // still Escalated's admin gate on the embedded admin
      agentGuard: AgentGuard,
      customerGuard: CustomerGuard,
      ui: {
        enabled: true,
        scripts: ['/build/app.js'],
        embed: embedAdmin({
          prefix: 'admin/support',
          guards: [BackOfficeGuard], // your back office's own check, run first
          layout: 'Layouts/AdminLayout',
        }),
      },
    }),
  ],
})
export class AppModule {}
```

or set the keys yourself (`ui.embed: { enabled: true, prefix: 'admin/support', ... }`),
or from the environment: `ESCALATED_EMBED=true`, `ESCALATED_EMBED_MODE`,
`ESCALATED_EMBED_PREFIX` and `ESCALATED_EMBED_FRAME_ANCESTORS` are read when
the matching option is not set.

## Configuration reference

| Option (`ui.embed.*`) | Env var | Default | Meaning |
|---|---|---|---|
| `enabled` | `ESCALATED_EMBED` | `false` | Master switch. While `false` (or while `ui.enabled` is off), nothing below has any effect. |
| `mode` | `ESCALATED_EMBED_MODE` | `'layout'` | `'layout'` (Vue + Inertia or server-rendered host) or `'iframe'`. |
| `prefix` | `ESCALATED_EMBED_PREFIX` | `'admin/support'` | URL prefix the admin moves under, instead of `escalated/admin`. Leading and trailing slashes are trimmed. |
| `middleware` | | `null` | Your middleware (`NestMiddleware` classes or Express functions) for the embedded admin routes only, run before any guard. `null`: none. |
| `guards` | | `null` | Your guards (`CanActivate` classes or instances) for the embedded admin routes only, run before Escalated's admin gate. `null`: none, so `adminGuard` alone decides, as on the standalone admin. |
| `replaceAdminGate` | | `false` | `true` removes Escalated's admin gate (`adminGuard`) from these routes so your `guards` / `middleware` alone decide. Refused at boot without any. See [Security](#security). |
| `layout` | | `null` | Name of your Vue admin layout, matched against the frontend plugin's `layouts` option. |
| `rootView` | | `null` | `(page, request) => html` for a first visit to an embedded page ([server-rendered host](#2-server-rendered-host)). `null` keeps `ui.rootView`. |
| `frameAncestors` | `ESCALATED_EMBED_FRAME_ANCESTORS` (comma-separated) | `[]` | iframe mode: exact origins allowed to frame the admin. Wildcards, `*` and anything that is not an `http(s)` origin are dropped. |

`embedAdmin()` throws on an unknown `mode`, and on `replaceAdminGate: true`
without any `guards` or `middleware`.

## What changes, and what does not

While embedding is on:

- Every admin route that lived under `/escalated/admin` (the admin screens,
  the admin JSON API, plugin admin and plugin pages, API tokens, the SSO
  settings) is mounted under your `prefix` instead, through your `middleware`,
  then your `guards`, then Escalated's admin gate (`adminGuard`, unless you
  replace it), two-factor and route permissions. The same controllers and
  handlers answer; their other guards and interceptors are unchanged.
- The named routes the screens build URLs from (the `ziggy` prop, and the
  redirects the controllers send) keep their names, so the shared frontend's
  `route('escalated.admin.…')` links follow. The old `/escalated/admin/...`
  URLs answer 404.
- Embedded pages carry `escalated.embed`, and every Inertia page carries
  `escalated.navigation`, the admin menu for your sidebar.

`escalated.embed` on an embedded page:

```json
{
  "enabled": true,
  "mode": "layout",
  "layout": "Layouts/AdminLayout",
  "route": "escalated.admin.tags.index",
  "base_url": "/admin/support",
  "allowed_origins": []
}
```

On every other page `enabled` is `false` and `route` is `null`.

## 1. Vue + Inertia host

Backend: turn embedding on ([above](#turning-it-on)) with your prefix, guards
and the name of your admin layout.

Frontend (your Inertia entry): register your admin layout under the name you
gave `layout`, or add `admin` to the plugin's `layoutScope`:

```js
import { createApp, h } from 'vue';
import { createInertiaApp } from '@inertiajs/vue3';
import { EscalatedPlugin, resolveEscalatedPage } from '@escalated-dev/escalated';
import AdminLayout from './Layouts/AdminLayout.vue';
import PublicLayout from './Layouts/PublicLayout.vue';

createInertiaApp({
  resolve: (name) => resolveEscalatedPage(name),
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .use(EscalatedPlugin, {
        layout: PublicLayout, // customer pages, as before
        layouts: { 'Layouts/AdminLayout': AdminLayout }, // embedded admin pages
        theme: { panel: { mode: 'light' } }, // match your admin
      })
      .mount(el);
  },
});
```

To use one layout for both, use `layout: AdminLayout, layoutScope: ['customer', 'admin']`
instead of `layouts`.

Your admin layout needs the slots the plugin's `layout` always required, a
`#header` slot (Escalated puts the page title there) and a default slot. List
Escalated's menu with `<EscalatedNavigation />`:

```vue
<!-- Layouts/AdminLayout.vue -->
<script setup>
import { EscalatedNavigation } from '@escalated-dev/escalated';
</script>

<template>
  <div class="flex min-h-screen">
    <aside class="w-64 border-r bg-white p-3">
      <a href="/admin">Dashboard</a>
      <!-- ...your own items... -->
      <p class="mt-4 px-3 text-xs font-semibold uppercase text-gray-500">Support</p>
      <EscalatedNavigation />
    </aside>
    <div class="flex-1">
      <header class="border-b bg-white px-6 py-4"><slot name="header" /></header>
      <main class="p-6"><slot /></main>
    </div>
  </div>
</template>
```

Escalated renders each admin page chrome-free (no Escalated sidebar, top bar,
logo or footer) inside your layout.

## 2. Server-rendered host

If your admin layout is a server-side template, give `rootView` a function
that renders it around the Inertia mount point. It is used for the first
(non-Inertia) visit to embedded admin pages only; every other page keeps
`ui.rootView` (or the default document). The page object carries the menu as
`page.props.escalated.navigation`, already filtered for the user:

```ts
import {
  embedAdmin,
  escapeHtml,
  ROUTE_HELPER,
  scriptJson,
  type EscalatedNavigationItem,
  type InertiaPageObject,
} from '@escalated-dev/escalated-nestjs';

export function hostAdminRootView(page: InertiaPageObject): string {
  const escalated = page.props.escalated as { navigation?: EscalatedNavigationItem[] };
  const menu = (escalated.navigation ?? [])
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.url)}"${
          item.active ? ' class="active" aria-current="page"' : ''
        }>${escapeHtml(item.label)}</a></li>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Back office</title>
    <link rel="stylesheet" href="/build/admin.css">
    <script type="module" src="/build/app.js"></script>
  </head>
  <body>
    <header class="backoffice-header">Back office</header>
    <aside data-host-admin-sidebar>
      <p class="menu-heading">Support</p>
      <ul>${menu}</ul>
    </aside>
    <main>
      <script data-page="app" type="application/json">${scriptJson(page)}</script>
      <div id="app" data-page="${escapeHtml(JSON.stringify(page))}"></div>
    </main>
    <script>${ROUTE_HELPER}</script>
  </body>
</html>`;
}

// EscalatedModule.forRoot({ ..., ui: { enabled: true,
//   embed: embedAdmin({ prefix: 'admin/support', guards: [BackOfficeGuard], rootView: hostAdminRootView }) } })
```

This is the template the package's tests render
(`test/fixtures/embed/host.ts`). Put the page object in the document the way
your Inertia client reads it (both forms above cover Inertia 1-3), and include
`ROUTE_HELPER` unless your bundle installs `route()` itself (ziggy-js).
Your Inertia entry needs no extra option: Escalated sees
`escalated.embed.enabled` and renders the page chrome-free (title + content).

Outside Inertia (your own back-office pages, a Handlebars layout rendered by
your controllers), inject `EscalatedAdminNavigation`, which the module
exports, for the same list:

```ts
import { Controller, Get, Render, Req } from '@nestjs/common';
import { EscalatedAdminNavigation } from '@escalated-dev/escalated-nestjs';

@Controller('admin')
export class BackOfficeController {
  constructor(private readonly navigation: EscalatedAdminNavigation) {}

  @Get()
  @Render('admin/dashboard')
  async dashboard(@Req() req: any) {
    // isAdmin: whether your app counts this user as an Escalated admin
    return { support: await this.navigation.adminNavigation(req.user, req, { isAdmin: req.user?.isAdmin }) };
  }
}
```

Without `isAdmin` the helper uses `ticketAccess.resolveUser` when configured,
else gives an empty list (it cannot run `adminGuard` outside an Escalated
route), unless `replaceAdminGate` is on.

## 3. iframe

For an admin that is not part of this app (another origin, another stack),
frame the embedded admin:

```ts
embed: embedAdmin({
  prefix: 'admin/support',
  mode: 'iframe',
  frameAncestors: ['https://admin.example.com'],
}),
```

or `ESCALATED_EMBED=true`, `ESCALATED_EMBED_MODE=iframe`,
`ESCALATED_EMBED_FRAME_ANCESTORS=https://admin.example.com`.

Embedded responses then carry
`Content-Security-Policy: frame-ancestors 'self' https://admin.example.com`
(`'self'` alone when the list is empty) and no `X-Frame-Options`. Both are
applied when the response's headers are written, so a `helmet()` or other
middleware that sets `X-Frame-Options` earlier does not undo them; no other
response is touched. If your app already sends a CSP, it is kept and this
directive is added as a second policy; if your own policy has a
`frame-ancestors` directive, list the same origins there too, since browsers
enforce both.

On the framing page:

```html
<iframe id="support-admin" src="https://support.example.com/admin/support/tickets"
        style="width:100%;border:0" title="Support administration"></iframe>
<script type="module">
  import { connectEscalatedFrame } from '@escalated-dev/escalated/embed';

  const frame = connectEscalatedFrame(document.getElementById('support-admin'), {
    origin: 'https://support.example.com',
    onNavigate: ({ route, title }) => highlightMenu(route),
  });
  frame.setTheme('light');
</script>
```

The frame sizes itself to its content and reports each page change; the
protocol is in the frontend guide.

### Cookies in a frame

- **Same site** (`admin.example.com` framing `support.example.com`): the default
  `SameSite=Lax` cookies work.
- **Cross-site** (different registrable domains): your session cookie must be
  sent in a third-party context. With express-session:
  `session({ cookie: { sameSite: 'none', secure: true }, ... })` (and
  `app.set('trust proxy', 1)` behind a TLS-terminating proxy); with
  Escalated's own session (two-factor / SSO without a host session):
  `session: { cookie: { sameSite: 'none', secure: true } }` in
  `EscalatedModule.forRoot()`. Serve both sites over HTTPS. The cookies the
  screens set themselves (flash messages, the import wizard) switch to
  `SameSite=None; Secure` on embedded iframe responses over HTTPS.
- Browsers that block third-party cookies entirely will still not keep a
  session in a cross-site frame; use the Vue + Inertia or server-rendered setup
  in that case.
- The screens' cross-site form protection (`X-Inertia` / `X-Requested-With`
  required on writes) is unchanged.

## The admin menu: `escalated.navigation`

While embedding is on, every Inertia page shares the admin menu:

```json
[
  {
    "key": "tickets",
    "label": "Tickets",
    "route": "escalated.admin.tickets.index",
    "url": "/admin/support/tickets",
    "icon": "tickets",
    "position": 20,
    "active": true,
    "badge": null,
    "plugin": null,
    "children": []
  }
]
```

It is filtered for the user: empty for anyone who fails Escalated's admin gate
(unless you replaced it), Roles is left out while roles & permissions is off,
Newsletters while `enableNewsletters` is off, and while roles & permissions is
on each item needs the permissions its route requires. Active plugins' admin
menu items are included (`key` `plugin:<slug>:<n>`, `route` `null`), sorted by
`position` with the core items. Core `icon` keys match the frontend's
`escalatedNavIcons`. The Newsletters item has `route: null` and
`url: "/admin/newsletters"`: this package's newsletter admin has no named
route.

## Security

- **The admin gate stays on by default.** Your `guards` and `middleware` run
  *in addition to* Escalated's `adminGuard`. Set `replaceAdminGate` only if
  they themselves restrict the routes to admins: with it on, they are the only
  check on who reaches the admin. Two-factor and route permissions still apply
  either way, and the agent panel and `escalated.is_admin` keep using
  Escalated's guards.
- **Framing is allow-listed.** In iframe mode only the origins you list (plus
  your own) may frame the admin; nothing else, and never `*`.
- **No open `postMessage`.** The frame talks only to an allow-listed parent
  origin and ignores messages from anywhere else.

## What does not move

The agent panel (`/escalated/agent`), customer portal, guest pages, knowledge
base, widget, API (`/escalated/api/...`), SSO sign-in, the two-factor
enrolment page and challenge (`/escalated/admin/settings/two-factor`,
`/escalated/two-factor/challenge`: personal, staff-wide pages), and the
newsletter admin (`/admin/newsletters`).

## Turning it off

Remove `ui.embed` (or set `enabled: false`, or unset `ESCALATED_EMBED`) and
restart. The admin returns to `/escalated/admin` with Escalated's own chrome.
