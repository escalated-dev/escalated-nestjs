<p align="center"><sub>
  <a href="docs/translations/README.ar.md">العربية</a> ·
  <a href="docs/translations/README.de.md">Deutsch</a> ·
  <b>English</b> ·
  <a href="docs/translations/README.es.md">Español</a> ·
  <a href="docs/translations/README.fr.md">Français</a> ·
  <a href="docs/translations/README.it.md">Italiano</a> ·
  <a href="docs/translations/README.ja.md">日本語</a> ·
  <a href="docs/translations/README.ko.md">한국어</a> ·
  <a href="docs/translations/README.nl.md">Nederlands</a> ·
  <a href="docs/translations/README.pl.md">Polski</a> ·
  <a href="docs/translations/README.pt-BR.md">Português (BR)</a> ·
  <a href="docs/translations/README.ru.md">Русский</a> ·
  <a href="docs/translations/README.tr.md">Türkçe</a> ·
  <a href="docs/translations/README.zh-CN.md">简体中文</a>
</sub></p>

<p align="center">
  <a href="https://escalated.dev"><img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/logo.png" width="72" height="72" alt="Escalated"></a>
</p>

<h1 align="center">Escalated for NestJS</h1>

<p align="center">
  Add a complete helpdesk to your NestJS app.<br>
  Tickets, SLAs, escalation rules, an agent inbox and a customer portal, running on your own database.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Website</b></a> ·
  <a href="https://escalated.dev/docs"><b>Docs</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="The Escalated agent inbox: saved views with counts, SLA countdowns and priorities on every ticket" width="100%">
</picture>

## What it does

<table>
  <tr>
    <td width="40%">
      <h3>An inbox your agents can work in all day</h3>
      Conversation, internal notes, canned replies and SLA timers on one screen. Tickets also arrive by email through Postmark, Mailgun or SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="A ticket open in the agent workspace with the reply composer">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="The admin reports page with response times, CSAT and SLA breaches">
      </picture>
    </td>
    <td width="40%">
      <h3>SLAs and escalation rules you can see</h3>
      Response and resolution targets with business hours, rules that reassign and notify when they slip, and reports on breaches.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>A customer portal that's already built</h3>
      Customers open tickets, reply and check status from your app. Embed the widget on other sites with one script tag.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="The customer portal ticket list">
      </picture>
    </td>
  </tr>
</table>

## Features

<table>
<tr>
<td width="33%" valign="top">

**Tickets and inbox**
- Priorities, departments, tags and custom fields
- Merge, link and split tickets
- Snooze with automatic wake-up
- Side conversations inside a ticket
- Personal and shared saved views
- Macros and canned responses

</td>
<td width="33%" valign="top">

**SLAs and routing**
- Response and resolution targets
- Business hours support
- Escalation rules on SLA breach
- Per-agent capacity limits
- Skill-based routing

</td>
<td width="33%" valign="top">

**Customers**
- Widget API with rate limiting
- Public tickets from widget or email
- Signed Reply-To email threading
- Configurable guest policy
- Token-based guest access
- CSAT surveys after resolution
- Knowledge base with search and ratings

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automation**
- Workflows on ticket and reply events
- Scheduled SLA checks and snooze wake-up
- HMAC-signed webhooks with retries
- Opt-in real-time updates over Socket.IO

</td>
<td width="33%" valign="top">

**Access and security**
- Roles and permissions with Nest guards
- Two-factor authentication (TOTP)
- SSO with SAML, OAuth 2 / OIDC or JWT
- Bearer API tokens with scoped abilities
- Audit log of every change

</td>
<td width="33%" valign="top">

**Extending**
- Plugins built with the plugin SDK
- Bulk import of tickets, tags, departments
- Translations from @escalated-dev/locale
- Host overrides for any translation

</td>
</tr>
</table>

<p align="center"><sub><a href="docs/features.md">Every feature in detail</a></sub></p>

<p align="center"><b>Built with</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Quick start

```bash
npm install @escalated-dev/escalated-nestjs
```

Then add `EscalatedModule.forRoot()` to your `AppModule` with your own `adminGuard`, `agentGuard` and `customerGuard`, and set `ui: { enabled: true }` to serve the screens (they are off by default). Needs Node.js 22+, NestJS 11 and TypeORM 0.3. The [getting started guide](docs/getting-started.md) covers every option.

## Learn more

- [All features](docs/features.md) · [Getting started](docs/getting-started.md) · [The screens (Inertia UI)](docs/ui.md)
- [API reference](docs/api.md) · [Events and extension points](docs/extending.md) · [Workflows](docs/workflows.md)
- [Agent panel](docs/agent-panel.md) · [Access control](docs/access-control.md) · [Ticket access and routing](docs/ticket-access-and-routing.md)
- [Embedding the widget](docs/embedding-the-widget.md) · [Embedding the admin](docs/embedding-admin.md) · [Guest access](docs/guest-access.md)
- [Plugins](docs/plugins.md) · [Newsletters](docs/newsletters.md) · [Development](docs/development.md) · [Dependency audit](docs/dependency-audit.md)

Escalated is also available for [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) and [Filament](https://github.com/escalated-dev/escalated-filament). The UI lives in [escalated](https://github.com/escalated-dev/escalated).

## License

MIT. Copyright (c) 2026 Escalated.dev. See [LICENSE](LICENSE).
