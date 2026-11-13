<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <b>Deutsch</b> ·
  <a href="../../README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.it.md">Italiano</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.nl.md">Nederlands</a> ·
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
  Füge deiner NestJS-App einen vollständigen Helpdesk hinzu.<br>
  Tickets, SLAs, Eskalationsregeln, ein Agenten-Posteingang und ein Kundenportal, direkt auf deiner eigenen Datenbank.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Website</b></a> ·
  <a href="https://escalated.dev/docs"><b>Dokumentation</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Änderungsprotokoll</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="Der Agenten-Posteingang von Escalated: gespeicherte Ansichten mit Zählern, SLA-Countdowns und Prioritäten an jedem Ticket" width="100%">
</picture>

## Was es kann

<table>
  <tr>
    <td width="40%">
      <h3>Ein Posteingang, in dem deine Agenten den ganzen Tag arbeiten können</h3>
      Konversation, interne Notizen, Textbausteine und SLA-Timer auf einem Bildschirm. Tickets kommen auch per E-Mail über Postmark, Mailgun oder SES an.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Ein geöffnetes Ticket im Agenten-Arbeitsbereich mit dem Antwort-Editor">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="Die Berichtsseite im Adminbereich mit Antwortzeiten, CSAT und SLA-Verstößen">
      </picture>
    </td>
    <td width="40%">
      <h3>SLAs und Eskalationsregeln, die du im Blick hast</h3>
      Reaktions- und Lösungsziele mit Geschäftszeiten, Regeln, die neu zuweisen und benachrichtigen, wenn ein Ziel verfehlt wird, und Berichte über Verstöße.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Ein Kundenportal, das schon fertig ist</h3>
      Kunden eröffnen Tickets, antworten und prüfen den Status direkt in deiner App. Mit einem einzigen Script-Tag bettest du das Widget auf anderen Websites ein.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="Die Ticketliste im Kundenportal">
      </picture>
    </td>
  </tr>
</table>

## Funktionen

<table>
<tr>
<td width="33%" valign="top">

**Tickets und Posteingang**
- Prioritäten, Abteilungen, Tags und benutzerdefinierte Felder
- Tickets zusammenführen, verknüpfen und aufteilen
- Zurückstellen mit automatischem Wiederaufwecken
- Nebenkonversationen innerhalb eines Tickets
- Persönliche und geteilte gespeicherte Ansichten
- Makros und Textbausteine

</td>
<td width="33%" valign="top">

**SLAs und Routing**
- Reaktions- und Lösungsziele
- Unterstützung für Geschäftszeiten
- Eskalationsregeln bei SLA-Verstößen
- Kapazitätsgrenzen pro Agent
- Kompetenzbasiertes Routing

</td>
<td width="33%" valign="top">

**Kunden**
- Widget-API mit Rate Limiting
- Öffentliche Tickets per Widget oder E-Mail
- E-Mail-Threading über signierte Reply-To-Adressen
- Konfigurierbare Gast-Richtlinie
- Tokenbasierter Gastzugang
- CSAT-Umfragen nach der Lösung
- Wissensdatenbank mit Suche und Bewertungen

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automatisierung**
- Workflows bei Ticket- und Antwort-Events
- Geplante SLA-Prüfungen und Wiederaufwecken zurückgestellter Tickets
- HMAC-signierte Webhooks mit Wiederholungsversuchen
- Optionale Echtzeit-Updates über Socket.IO

</td>
<td width="33%" valign="top">

**Zugriff und Sicherheit**
- Rollen und Berechtigungen mit Nest-Guards
- Zwei-Faktor-Authentifizierung (TOTP)
- SSO mit SAML, OAuth 2 / OIDC oder JWT
- Bearer-API-Tokens mit eingeschränkten Berechtigungen
- Audit-Log jeder Änderung

</td>
<td width="33%" valign="top">

**Erweitern**
- Plugins, gebaut mit dem Plugin-SDK
- Massenimport von Tickets, Tags und Abteilungen
- Übersetzungen aus @escalated-dev/locale
- Überschreiben jeder Übersetzung in deiner App

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Alle Funktionen im Detail</a></sub></p>

<p align="center"><b>Gebaut mit</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Schnellstart

```bash
npm install @escalated-dev/escalated-nestjs
```

Füge danach `EscalatedModule.forRoot()` mit deinem eigenen `adminGuard`, `agentGuard` und `customerGuard` zu deinem `AppModule` hinzu und setze `ui: { enabled: true }`, damit die Oberflächen ausgeliefert werden (standardmäßig sind sie aus). Voraussetzungen: Node.js 22+, NestJS 11 und TypeORM 0.3. Die [Einstiegsanleitung](../getting-started.md) erklärt jede Option.

## Mehr erfahren

- [Alle Funktionen](../features.md) · [Erste Schritte](../getting-started.md) · [Die Oberflächen (Inertia UI)](../ui.md)
- [API-Referenz](../api.md) · [Events und Erweiterungspunkte](../extending.md) · [Workflows](../workflows.md)
- [Agenten-Panel](../agent-panel.md) · [Zugriffskontrolle](../access-control.md) · [Ticketzugriff und Routing](../ticket-access-and-routing.md)
- [Widget einbetten](../embedding-the-widget.md) · [Adminbereich einbetten](../embedding-admin.md) · [Gastzugang](../guest-access.md)
- [Plugins](../plugins.md) · [Newsletter](../newsletters.md) · [Entwicklung](../development.md) · [Abhängigkeitsprüfung](../dependency-audit.md)

Escalated gibt es auch für [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) und [Filament](https://github.com/escalated-dev/escalated-filament). Die Oberfläche liegt in [escalated](https://github.com/escalated-dev/escalated).

## Lizenz

MIT. Copyright (c) 2026 Escalated.dev. Siehe [LICENSE](../../LICENSE).
