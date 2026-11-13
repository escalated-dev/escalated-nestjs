<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="../../README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.it.md">Italiano</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <b>Nederlands</b> ·
  <a href="README.pl.md">Polski</a> ·
  <a href="README.pt-BR.md">Português (BR)</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</sub></p>

<p align="center">
  <a href="https://escalated.dev"><img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/logo.png" width="72" height="72" alt="Escalated"></a>
</p>

<h1 align="center">Escalated for NestJS</h1>

<p align="center">
  Voeg een complete helpdesk toe aan je NestJS-app.<br>
  Tickets, SLA's, escalatieregels, een inbox voor agents en een klantenportaal, op je eigen database.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Website</b></a> ·
  <a href="https://escalated.dev/docs"><b>Documentatie</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Wijzigingslog</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="De agent-inbox van Escalated: opgeslagen weergaven met aantallen, SLA-afteltimers en prioriteiten bij elk ticket" width="100%">
</picture>

## Wat het doet

<table>
  <tr>
    <td width="40%">
      <h3>Een inbox waarin je agents de hele dag kunnen werken</h3>
      Gesprek, interne notities, standaardantwoorden en SLA-timers op één scherm. Tickets komen ook binnen per e-mail via Postmark, Mailgun of SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Een geopend ticket in de agent-werkruimte met de antwoordeditor">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="De rapportpagina voor beheerders met reactietijden, CSAT en SLA-overschrijdingen">
      </picture>
    </td>
    <td width="40%">
      <h3>SLA's en escalatieregels die je kunt zien</h3>
      Reactie- en oplosdoelen met kantooruren, regels die opnieuw toewijzen en meldingen sturen als een doel wordt gemist, en rapporten over overschrijdingen.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Een klantenportaal dat al klaar is</h3>
      Klanten openen tickets, reageren en bekijken de status vanuit je app. Met één scripttag zet je de widget op andere sites.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="De ticketlijst in het klantenportaal">
      </picture>
    </td>
  </tr>
</table>

## Functies

<table>
<tr>
<td width="33%" valign="top">

**Tickets en inbox**
- Prioriteiten, afdelingen, tags en aangepaste velden
- Tickets samenvoegen, koppelen en splitsen
- Uitstellen met automatisch heropenen
- Zijgesprekken binnen een ticket
- Persoonlijke en gedeelde opgeslagen weergaven
- Macro's en standaardantwoorden

</td>
<td width="33%" valign="top">

**SLA's en routering**
- Reactie- en oplosdoelen
- Ondersteuning voor kantooruren
- Escalatieregels bij SLA-overschrijding
- Capaciteitslimieten per agent
- Routering op basis van vaardigheden

</td>
<td width="33%" valign="top">

**Klanten**
- Widget-API met rate limiting
- Openbare tickets via widget of e-mail
- E-mailthreads met ondertekende Reply-To
- Instelbaar gastbeleid
- Gasttoegang met tokens
- CSAT-enquêtes na afhandeling
- Kennisbank met zoekfunctie en beoordelingen

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automatisering**
- Workflows bij ticket- en antwoordgebeurtenissen
- Geplande SLA-controles en heropenen na uitstel
- Met HMAC ondertekende webhooks met herhaalpogingen
- Optionele realtime updates via Socket.IO

</td>
<td width="33%" valign="top">

**Toegang en beveiliging**
- Rollen en rechten met Nest-guards
- Tweestapsverificatie (TOTP)
- SSO met SAML, OAuth 2 / OIDC of JWT
- Bearer-API-tokens met afgebakende rechten
- Auditlog van elke wijziging

</td>
<td width="33%" valign="top">

**Uitbreiden**
- Plugins gebouwd met de plugin-SDK
- Bulkimport van tickets, tags en afdelingen
- Vertalingen uit @escalated-dev/locale
- Elke vertaling te overschrijven vanuit je app

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Alle functies in detail</a></sub></p>

<p align="center"><b>Gebouwd met</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Snel aan de slag

```bash
npm install @escalated-dev/escalated-nestjs
```

Voeg daarna `EscalatedModule.forRoot()` toe aan je `AppModule` met je eigen `adminGuard`, `agentGuard` en `customerGuard`, en zet `ui: { enabled: true }` om de schermen te serveren (die staan standaard uit). Vereist Node.js 22+, NestJS 11 en TypeORM 0.3. De [handleiding om te beginnen](../getting-started.md) behandelt elke optie.

## Meer weten

- [Alle functies](../features.md) · [Aan de slag](../getting-started.md) · [De schermen (Inertia UI)](../ui.md)
- [API-referentie](../api.md) · [Events en uitbreidingspunten](../extending.md) · [Workflows](../workflows.md)
- [Agentpaneel](../agent-panel.md) · [Toegangsbeheer](../access-control.md) · [Tickettoegang en routering](../ticket-access-and-routing.md)
- [De widget insluiten](../embedding-the-widget.md) · [De beheeromgeving insluiten](../embedding-admin.md) · [Gasttoegang](../guest-access.md)
- [Plugins](../plugins.md) · [Nieuwsbrieven](../newsletters.md) · [Ontwikkeling](../development.md) · [Audit van afhankelijkheden](../dependency-audit.md)

Escalated is ook beschikbaar voor [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) en [Filament](https://github.com/escalated-dev/escalated-filament). De UI staat in [escalated](https://github.com/escalated-dev/escalated).

## Licentie

MIT. Copyright (c) 2026 Escalated.dev. Zie [LICENSE](../../LICENSE).
