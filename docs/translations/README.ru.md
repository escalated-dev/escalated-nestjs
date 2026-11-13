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
  <a href="README.pl.md">Polski</a> ·
  <a href="README.pt-BR.md">Português (BR)</a> ·
  <b>Русский</b> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</sub></p>

<p align="center">
  <a href="https://escalated.dev"><img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/logo.png" width="72" height="72" alt="Escalated"></a>
</p>

<h1 align="center">Escalated for NestJS</h1>

<p align="center">
  Добавьте полноценный хелпдеск в своё приложение на NestJS.<br>
  Тикеты, SLA, правила эскалации, входящие для агентов и клиентский портал, которые работают на вашей собственной базе данных.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Сайт</b></a> ·
  <a href="https://escalated.dev/docs"><b>Документация</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Список изменений</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="Входящие агента в Escalated: сохранённые представления со счётчиками, таймеры SLA и приоритеты у каждого тикета" width="100%">
</picture>

## Что он делает

<table>
  <tr>
    <td width="40%">
      <h3>Входящие, в которых агенты могут работать весь день</h3>
      Переписка, внутренние заметки, шаблоны ответов и таймеры SLA на одном экране. Тикеты также приходят по почте через Postmark, Mailgun или SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Открытый тикет в рабочем пространстве агента с редактором ответа">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="Страница отчётов администратора со временем ответа, CSAT и нарушениями SLA">
      </picture>
    </td>
    <td width="40%">
      <h3>SLA и правила эскалации на виду</h3>
      Цели по времени ответа и решения с учётом рабочих часов, правила, которые переназначают тикет и отправляют уведомления при срыве сроков, и отчёты о нарушениях.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Готовый клиентский портал</h3>
      Клиенты создают тикеты, отвечают и проверяют статус прямо в вашем приложении. Виджет встраивается на другие сайты одним тегом script.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="Список тикетов в клиентском портале">
      </picture>
    </td>
  </tr>
</table>

## Возможности

<table>
<tr>
<td width="33%" valign="top">

**Тикеты и входящие**
- Приоритеты, отделы, теги и пользовательские поля
- Объединение, связывание и разделение тикетов
- Откладывание с автоматическим возвратом
- Побочные переписки внутри тикета
- Личные и общие сохранённые представления
- Макросы и шаблоны ответов

</td>
<td width="33%" valign="top">

**SLA и маршрутизация**
- Цели по времени ответа и решения
- Поддержка рабочих часов
- Правила эскалации при нарушении SLA
- Ограничения нагрузки для каждого агента
- Маршрутизация по навыкам

</td>
<td width="33%" valign="top">

**Клиенты**
- API виджета с ограничением частоты запросов
- Публичные тикеты из виджета или по почте
- Цепочки писем с подписанным Reply-To
- Настраиваемая политика для гостей
- Гостевой доступ по токену
- Опросы CSAT после решения
- База знаний с поиском и оценками

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Автоматизация**
- Workflows на события тикетов и ответов
- Плановые проверки SLA и возврат отложенных тикетов
- Вебхуки с подписью HMAC и повторными попытками
- Обновления в реальном времени через Socket.IO (по желанию)

</td>
<td width="33%" valign="top">

**Доступ и безопасность**
- Роли и права с guards из Nest
- Двухфакторная аутентификация (TOTP)
- SSO через SAML, OAuth 2 / OIDC или JWT
- Bearer-токены API с ограниченными правами
- Журнал аудита всех изменений

</td>
<td width="33%" valign="top">

**Расширение**
- Плагины на основе plugin SDK
- Массовый импорт тикетов, тегов и отделов
- Переводы из @escalated-dev/locale
- Переопределение любого перевода в вашем приложении

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Все возможности подробно</a></sub></p>

<p align="center"><b>Сделано с помощью</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Быстрый старт

```bash
npm install @escalated-dev/escalated-nestjs
```

Затем добавьте `EscalatedModule.forRoot()` в свой `AppModule` со своими `adminGuard`, `agentGuard` и `customerGuard` и задайте `ui: { enabled: true }`, чтобы отдавать экраны (по умолчанию они выключены). Нужны Node.js 22+, NestJS 11 и TypeORM 0.3. В [руководстве по началу работы](../getting-started.md) описаны все параметры.

## Подробнее

- [Все возможности](../features.md) · [Начало работы](../getting-started.md) · [Экраны (Inertia UI)](../ui.md)
- [Справочник API](../api.md) · [События и точки расширения](../extending.md) · [Workflows](../workflows.md)
- [Панель агента](../agent-panel.md) · [Управление доступом](../access-control.md) · [Доступ к тикетам и маршрутизация](../ticket-access-and-routing.md)
- [Встраивание виджета](../embedding-the-widget.md) · [Встраивание админки](../embedding-admin.md) · [Гостевой доступ](../guest-access.md)
- [Плагины](../plugins.md) · [Рассылки](../newsletters.md) · [Разработка](../development.md) · [Аудит зависимостей](../dependency-audit.md)

Escalated также доступен для [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) и [Filament](https://github.com/escalated-dev/escalated-filament). Интерфейс находится в [escalated](https://github.com/escalated-dev/escalated).

## Лицензия

MIT. Copyright (c) 2026 Escalated.dev. См. [LICENSE](../../LICENSE).
