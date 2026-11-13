<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="../../README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <b>Italiano</b> ·
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
  Aggiungi un helpdesk completo alla tua app NestJS.<br>
  Ticket, SLA, regole di escalation, una inbox per gli agenti e un portale clienti, sul tuo database.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Sito web</b></a> ·
  <a href="https://escalated.dev/docs"><b>Documentazione</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Registro delle modifiche</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="La inbox degli agenti di Escalated: viste salvate con contatori, conti alla rovescia SLA e priorità su ogni ticket" width="100%">
</picture>

## Cosa fa

<table>
  <tr>
    <td width="40%">
      <h3>Una inbox in cui i tuoi agenti possono lavorare tutto il giorno</h3>
      Conversazione, note interne, risposte predefinite e timer SLA in un'unica schermata. I ticket arrivano anche via email tramite Postmark, Mailgun o SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Un ticket aperto nell'area di lavoro dell'agente con l'editor di risposta">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="La pagina dei report dell'amministrazione con tempi di risposta, CSAT e violazioni degli SLA">
      </picture>
    </td>
    <td width="40%">
      <h3>SLA e regole di escalation sempre visibili</h3>
      Obiettivi di risposta e risoluzione con orari lavorativi, regole che riassegnano e notificano quando slittano, e report sulle violazioni.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Un portale clienti già pronto</h3>
      I clienti aprono ticket, rispondono e controllano lo stato dalla tua app. Incorpora il widget su altri siti con un solo tag script.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="L'elenco dei ticket nel portale clienti">
      </picture>
    </td>
  </tr>
</table>

## Funzionalità

<table>
<tr>
<td width="33%" valign="top">

**Ticket e inbox**
- Priorità, reparti, tag e campi personalizzati
- Unire, collegare e dividere i ticket
- Posticipo con riattivazione automatica
- Conversazioni parallele all'interno di un ticket
- Viste salvate personali e condivise
- Macro e risposte predefinite

</td>
<td width="33%" valign="top">

**SLA e instradamento**
- Obiettivi di risposta e risoluzione
- Supporto degli orari lavorativi
- Regole di escalation alla violazione di uno SLA
- Limiti di capacità per agente
- Instradamento per competenze

</td>
<td width="33%" valign="top">

**Clienti**
- API del widget con limitazione delle richieste
- Ticket pubblici da widget o email
- Thread email con Reply-To firmato
- Politica ospiti configurabile
- Accesso ospite basato su token
- Sondaggi CSAT dopo la risoluzione
- Knowledge base con ricerca e valutazioni

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automazione**
- Workflow sugli eventi di ticket e risposte
- Controlli SLA pianificati e riattivazione dei posticipati
- Webhook firmati HMAC con nuovi tentativi
- Aggiornamenti in tempo reale opzionali tramite Socket.IO

</td>
<td width="33%" valign="top">

**Accesso e sicurezza**
- Ruoli e permessi con i guard di Nest
- Autenticazione a due fattori (TOTP)
- SSO con SAML, OAuth 2 / OIDC o JWT
- Token API Bearer con permessi limitati
- Registro di audit di ogni modifica

</td>
<td width="33%" valign="top">

**Estensione**
- Plugin creati con il plugin SDK
- Importazione in blocco di ticket, tag e reparti
- Traduzioni da @escalated-dev/locale
- Override di qualsiasi traduzione dalla tua app

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Tutte le funzionalità nel dettaglio</a></sub></p>

<p align="center"><b>Realizzato con</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Avvio rapido

```bash
npm install @escalated-dev/escalated-nestjs
```

Poi aggiungi `EscalatedModule.forRoot()` al tuo `AppModule` con i tuoi `adminGuard`, `agentGuard` e `customerGuard`, e imposta `ui: { enabled: true }` per servire le schermate (sono disattivate per impostazione predefinita). Richiede Node.js 22+, NestJS 11 e TypeORM 0.3. La [guida introduttiva](../getting-started.md) spiega ogni opzione.

## Per saperne di più

- [Tutte le funzionalità](../features.md) · [Primi passi](../getting-started.md) · [Le schermate (Inertia UI)](../ui.md)
- [Riferimento API](../api.md) · [Eventi e punti di estensione](../extending.md) · [Workflow](../workflows.md)
- [Pannello agente](../agent-panel.md) · [Controllo degli accessi](../access-control.md) · [Accesso ai ticket e instradamento](../ticket-access-and-routing.md)
- [Incorporare il widget](../embedding-the-widget.md) · [Incorporare l'amministrazione](../embedding-admin.md) · [Accesso ospite](../guest-access.md)
- [Plugin](../plugins.md) · [Newsletter](../newsletters.md) · [Sviluppo](../development.md) · [Audit delle dipendenze](../dependency-audit.md)

Escalated è disponibile anche per [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) e [Filament](https://github.com/escalated-dev/escalated-filament). L'interfaccia si trova in [escalated](https://github.com/escalated-dev/escalated).

## Licenza

MIT. Copyright (c) 2026 Escalated.dev. Vedi [LICENSE](../../LICENSE).
