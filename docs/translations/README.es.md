<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="../../README.md">English</a> ·
  <b>Español</b> ·
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
  Añade un helpdesk completo a tu app NestJS.<br>
  Tickets, SLAs, reglas de escalado, una bandeja de entrada para agentes y un portal de clientes, sobre tu propia base de datos.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Sitio web</b></a> ·
  <a href="https://escalated.dev/docs"><b>Documentación</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Registro de cambios</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="La bandeja de entrada de agentes de Escalated: vistas guardadas con contadores, cuentas atrás de SLA y prioridades en cada ticket" width="100%">
</picture>

## Qué hace

<table>
  <tr>
    <td width="40%">
      <h3>Una bandeja de entrada en la que tus agentes pueden trabajar todo el día</h3>
      Conversación, notas internas, respuestas predefinidas y temporizadores de SLA en una sola pantalla. Los tickets también llegan por correo a través de Postmark, Mailgun o SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Un ticket abierto en el espacio de trabajo del agente con el editor de respuestas">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="La página de informes del administrador con tiempos de respuesta, CSAT e incumplimientos de SLA">
      </picture>
    </td>
    <td width="40%">
      <h3>SLAs y reglas de escalado que puedes ver</h3>
      Objetivos de respuesta y resolución con horario laboral, reglas que reasignan y avisan cuando se incumplen, e informes sobre los incumplimientos.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Un portal de clientes que ya está construido</h3>
      Los clientes abren tickets, responden y consultan el estado desde tu app. Inserta el widget en otros sitios con una sola etiqueta script.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="La lista de tickets del portal de clientes">
      </picture>
    </td>
  </tr>
</table>

## Funciones

<table>
<tr>
<td width="33%" valign="top">

**Tickets y bandeja de entrada**
- Prioridades, departamentos, etiquetas y campos personalizados
- Fusionar, vincular y dividir tickets
- Posponer con reactivación automática
- Conversaciones paralelas dentro de un ticket
- Vistas guardadas personales y compartidas
- Macros y respuestas predefinidas

</td>
<td width="33%" valign="top">

**SLAs y enrutamiento**
- Objetivos de respuesta y resolución
- Soporte de horario laboral
- Reglas de escalado al incumplir un SLA
- Límites de capacidad por agente
- Enrutamiento por habilidades

</td>
<td width="33%" valign="top">

**Clientes**
- API del widget con límite de peticiones
- Tickets públicos desde el widget o por correo
- Hilos de correo con Reply-To firmado
- Política de invitados configurable
- Acceso de invitados basado en tokens
- Encuestas CSAT tras la resolución
- Base de conocimiento con búsqueda y valoraciones

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automatización**
- Workflows en eventos de tickets y respuestas
- Comprobaciones de SLA programadas y reactivación de pospuestos
- Webhooks firmados con HMAC y reintentos
- Actualizaciones en tiempo real opcionales con Socket.IO

</td>
<td width="33%" valign="top">

**Acceso y seguridad**
- Roles y permisos con guards de Nest
- Autenticación en dos pasos (TOTP)
- SSO con SAML, OAuth 2 / OIDC o JWT
- Tokens de API Bearer con permisos acotados
- Registro de auditoría de cada cambio

</td>
<td width="33%" valign="top">

**Extensión**
- Plugins creados con el SDK de plugins
- Importación masiva de tickets, etiquetas y departamentos
- Traducciones de @escalated-dev/locale
- Sobrescribe cualquier traducción desde tu app

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Todas las funciones en detalle</a></sub></p>

<p align="center"><b>Construido con</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Inicio rápido

```bash
npm install @escalated-dev/escalated-nestjs
```

Después añade `EscalatedModule.forRoot()` a tu `AppModule` con tus propios `adminGuard`, `agentGuard` y `customerGuard`, y define `ui: { enabled: true }` para servir las pantallas (están desactivadas por defecto). Requiere Node.js 22+, NestJS 11 y TypeORM 0.3. La [guía de inicio](../getting-started.md) explica todas las opciones.

## Más información

- [Todas las funciones](../features.md) · [Primeros pasos](../getting-started.md) · [Las pantallas (Inertia UI)](../ui.md)
- [Referencia de la API](../api.md) · [Eventos y puntos de extensión](../extending.md) · [Workflows](../workflows.md)
- [Panel del agente](../agent-panel.md) · [Control de acceso](../access-control.md) · [Acceso a tickets y enrutamiento](../ticket-access-and-routing.md)
- [Insertar el widget](../embedding-the-widget.md) · [Insertar el panel de administración](../embedding-admin.md) · [Acceso de invitados](../guest-access.md)
- [Plugins](../plugins.md) · [Boletines](../newsletters.md) · [Desarrollo](../development.md) · [Auditoría de dependencias](../dependency-audit.md)

Escalated también está disponible para [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) y [Filament](https://github.com/escalated-dev/escalated-filament). La interfaz está en [escalated](https://github.com/escalated-dev/escalated).

## Licencia

MIT. Copyright (c) 2026 Escalated.dev. Consulta [LICENSE](../../LICENSE).
