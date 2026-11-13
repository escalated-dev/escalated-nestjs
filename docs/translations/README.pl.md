<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="../../README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.it.md">Italiano</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.nl.md">Nederlands</a> ·
  <b>Polski</b> ·
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
  Dodaj kompletny helpdesk do swojej aplikacji NestJS.<br>
  Zgłoszenia, SLA, reguły eskalacji, skrzynka dla agentów i portal klienta, działające na twojej własnej bazie danych.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Strona</b></a> ·
  <a href="https://escalated.dev/docs"><b>Dokumentacja</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Lista zmian</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="Skrzynka agenta w Escalated: zapisane widoki z licznikami, odliczanie SLA i priorytety przy każdym zgłoszeniu" width="100%">
</picture>

## Co robi

<table>
  <tr>
    <td width="40%">
      <h3>Skrzynka, w której agenci mogą pracować cały dzień</h3>
      Rozmowa, notatki wewnętrzne, gotowe odpowiedzi i liczniki SLA na jednym ekranie. Zgłoszenia trafiają też e-mailem przez Postmark, Mailgun lub SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Otwarte zgłoszenie w panelu agenta z edytorem odpowiedzi">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="Strona raportów administratora z czasami odpowiedzi, CSAT i naruszeniami SLA">
      </picture>
    </td>
    <td width="40%">
      <h3>SLA i reguły eskalacji, które widzisz</h3>
      Cele czasu odpowiedzi i rozwiązania z godzinami pracy, reguły, które przepisują zgłoszenie i wysyłają powiadomienia, gdy cel zostanie przekroczony, oraz raporty naruszeń.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Portal klienta, który jest już gotowy</h3>
      Klienci otwierają zgłoszenia, odpowiadają i sprawdzają status w twojej aplikacji. Widżet osadzisz na innych stronach jednym tagiem script.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="Lista zgłoszeń w portalu klienta">
      </picture>
    </td>
  </tr>
</table>

## Funkcje

<table>
<tr>
<td width="33%" valign="top">

**Zgłoszenia i skrzynka**
- Priorytety, działy, tagi i pola niestandardowe
- Scalanie, łączenie i dzielenie zgłoszeń
- Odkładanie z automatycznym wznowieniem
- Rozmowy poboczne wewnątrz zgłoszenia
- Prywatne i wspólne zapisane widoki
- Makra i gotowe odpowiedzi

</td>
<td width="33%" valign="top">

**SLA i przydzielanie**
- Cele czasu odpowiedzi i rozwiązania
- Obsługa godzin pracy
- Reguły eskalacji przy naruszeniu SLA
- Limity obciążenia dla każdego agenta
- Przydzielanie według umiejętności

</td>
<td width="33%" valign="top">

**Klienci**
- API widżetu z limitem zapytań
- Publiczne zgłoszenia z widżetu lub e-maila
- Wątki e-mail z podpisanym Reply-To
- Konfigurowalna polityka gości
- Dostęp gości na podstawie tokenów
- Ankiety CSAT po rozwiązaniu
- Baza wiedzy z wyszukiwaniem i ocenami

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automatyzacja**
- Workflowy na zdarzenia zgłoszeń i odpowiedzi
- Zaplanowane kontrole SLA i wznawianie odłożonych
- Webhooki podpisane HMAC z ponawianiem
- Opcjonalne aktualizacje na żywo przez Socket.IO

</td>
<td width="33%" valign="top">

**Dostęp i bezpieczeństwo**
- Role i uprawnienia z guardami Nest
- Uwierzytelnianie dwuskładnikowe (TOTP)
- SSO przez SAML, OAuth 2 / OIDC lub JWT
- Tokeny API typu Bearer z zawężonymi uprawnieniami
- Dziennik audytu każdej zmiany

</td>
<td width="33%" valign="top">

**Rozszerzanie**
- Wtyczki tworzone za pomocą plugin SDK
- Masowy import zgłoszeń, tagów i działów
- Tłumaczenia z @escalated-dev/locale
- Nadpisywanie dowolnego tłumaczenia w aplikacji

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Wszystkie funkcje w szczegółach</a></sub></p>

<p align="center"><b>Zbudowane z użyciem</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Szybki start

```bash
npm install @escalated-dev/escalated-nestjs
```

Następnie dodaj `EscalatedModule.forRoot()` do swojego `AppModule` z własnymi `adminGuard`, `agentGuard` i `customerGuard`, a potem ustaw `ui: { enabled: true }`, aby udostępnić ekrany (domyślnie są wyłączone). Wymaga Node.js 22+, NestJS 11 i TypeORM 0.3. [Przewodnik na start](../getting-started.md) opisuje każdą opcję.

## Dowiedz się więcej

- [Wszystkie funkcje](../features.md) · [Pierwsze kroki](../getting-started.md) · [Ekrany (Inertia UI)](../ui.md)
- [Dokumentacja API](../api.md) · [Zdarzenia i punkty rozszerzeń](../extending.md) · [Workflowy](../workflows.md)
- [Panel agenta](../agent-panel.md) · [Kontrola dostępu](../access-control.md) · [Dostęp do zgłoszeń i przydzielanie](../ticket-access-and-routing.md)
- [Osadzanie widżetu](../embedding-the-widget.md) · [Osadzanie panelu administratora](../embedding-admin.md) · [Dostęp gości](../guest-access.md)
- [Wtyczki](../plugins.md) · [Newslettery](../newsletters.md) · [Rozwój](../development.md) · [Audyt zależności](../dependency-audit.md)

Escalated jest dostępny także dla [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) i [Filament](https://github.com/escalated-dev/escalated-filament). Interfejs znajduje się w [escalated](https://github.com/escalated-dev/escalated).

## Licencja

MIT. Copyright (c) 2026 Escalated.dev. Zobacz [LICENSE](../../LICENSE).
