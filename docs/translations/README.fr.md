<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="../../README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <b>Français</b> ·
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
  Ajoutez un helpdesk complet à votre application NestJS.<br>
  Tickets, SLA, règles d'escalade, une boîte de réception pour les agents et un portail client, sur votre propre base de données.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Site web</b></a> ·
  <a href="https://escalated.dev/docs"><b>Documentation</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Journal des modifications</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="La boîte de réception des agents d'Escalated : vues enregistrées avec compteurs, comptes à rebours SLA et priorités sur chaque ticket" width="100%">
</picture>

## Ce que ça fait

<table>
  <tr>
    <td width="40%">
      <h3>Une boîte de réception où vos agents peuvent travailler toute la journée</h3>
      Conversation, notes internes, réponses prédéfinies et minuteurs SLA sur un seul écran. Les tickets arrivent aussi par e-mail via Postmark, Mailgun ou SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Un ticket ouvert dans l'espace de travail de l'agent avec l'éditeur de réponse">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="La page de rapports de l'administration avec les temps de réponse, le CSAT et les dépassements de SLA">
      </picture>
    </td>
    <td width="40%">
      <h3>Des SLA et des règles d'escalade que vous voyez</h3>
      Objectifs de réponse et de résolution avec heures ouvrées, règles qui réassignent et notifient en cas de retard, et rapports sur les dépassements.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Un portail client déjà prêt</h3>
      Vos clients ouvrent des tickets, répondent et suivent leur statut depuis votre application. Intégrez le widget sur d'autres sites avec une seule balise script.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="La liste des tickets du portail client">
      </picture>
    </td>
  </tr>
</table>

## Fonctionnalités

<table>
<tr>
<td width="33%" valign="top">

**Tickets et boîte de réception**
- Priorités, départements, tags et champs personnalisés
- Fusionner, lier et scinder des tickets
- Mise en attente avec réveil automatique
- Conversations parallèles dans un ticket
- Vues enregistrées personnelles et partagées
- Macros et réponses prédéfinies

</td>
<td width="33%" valign="top">

**SLA et routage**
- Objectifs de réponse et de résolution
- Prise en charge des heures ouvrées
- Règles d'escalade en cas de dépassement de SLA
- Limites de capacité par agent
- Routage par compétences

</td>
<td width="33%" valign="top">

**Clients**
- API du widget avec limitation de débit
- Tickets publics depuis le widget ou par e-mail
- Fils d'e-mails via Reply-To signé
- Politique d'accès invité configurable
- Accès invité par jeton
- Enquêtes CSAT après résolution
- Base de connaissances avec recherche et notes

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automatisation**
- Workflows sur les événements de tickets et de réponses
- Vérifications SLA planifiées et réveil des tickets en attente
- Webhooks signés HMAC avec nouvelles tentatives
- Mises à jour en temps réel optionnelles via Socket.IO

</td>
<td width="33%" valign="top">

**Accès et sécurité**
- Rôles et permissions avec les guards Nest
- Authentification à deux facteurs (TOTP)
- SSO avec SAML, OAuth 2 / OIDC ou JWT
- Jetons d'API Bearer avec droits limités
- Journal d'audit de chaque modification

</td>
<td width="33%" valign="top">

**Extension**
- Plugins créés avec le SDK de plugins
- Import en masse de tickets, tags et départements
- Traductions issues de @escalated-dev/locale
- Remplacement de n'importe quelle traduction depuis votre application

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Toutes les fonctionnalités en détail</a></sub></p>

<p align="center"><b>Construit avec</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Démarrage rapide

```bash
npm install @escalated-dev/escalated-nestjs
```

Ajoutez ensuite `EscalatedModule.forRoot()` à votre `AppModule` avec vos propres `adminGuard`, `agentGuard` et `customerGuard`, et définissez `ui: { enabled: true }` pour servir les écrans (ils sont désactivés par défaut). Nécessite Node.js 22+, NestJS 11 et TypeORM 0.3. Le [guide de démarrage](../getting-started.md) détaille chaque option.

## En savoir plus

- [Toutes les fonctionnalités](../features.md) · [Premiers pas](../getting-started.md) · [Les écrans (Inertia UI)](../ui.md)
- [Référence de l'API](../api.md) · [Événements et points d'extension](../extending.md) · [Workflows](../workflows.md)
- [Panneau agent](../agent-panel.md) · [Contrôle d'accès](../access-control.md) · [Accès aux tickets et routage](../ticket-access-and-routing.md)
- [Intégrer le widget](../embedding-the-widget.md) · [Intégrer l'administration](../embedding-admin.md) · [Accès invité](../guest-access.md)
- [Plugins](../plugins.md) · [Newsletters](../newsletters.md) · [Développement](../development.md) · [Audit des dépendances](../dependency-audit.md)

Escalated est aussi disponible pour [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) et [Filament](https://github.com/escalated-dev/escalated-filament). L'interface se trouve dans [escalated](https://github.com/escalated-dev/escalated).

## Licence

MIT. Copyright (c) 2026 Escalated.dev. Voir [LICENSE](../../LICENSE).
