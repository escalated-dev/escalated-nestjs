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
  <a href="README.ru.md">Русский</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <b>简体中文</b>
</sub></p>

<p align="center">
  <a href="https://escalated.dev"><img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/logo.png" width="72" height="72" alt="Escalated"></a>
</p>

<h1 align="center">Escalated for NestJS</h1>

<p align="center">
  为你的 NestJS 应用添加一套完整的客服工单系统。<br>
  工单、SLA、升级规则、客服收件箱和客户门户，全部运行在你自己的数据库上。
</p>

<p align="center">
  <a href="https://escalated.dev"><b>官网</b></a> ·
  <a href="https://escalated.dev/docs"><b>文档</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>更新日志</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="Escalated 客服收件箱：带计数的已保存视图，每个工单都有 SLA 倒计时和优先级" width="100%">
</picture>

## 功能概览

<table>
  <tr>
    <td width="40%">
      <h3>客服可以整天使用的收件箱</h3>
      对话、内部备注、预设回复和 SLA 计时器都在同一个界面上。工单也可以通过 Postmark、Mailgun 或 SES 以邮件形式进入。
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="在客服工作区中打开的工单及回复编辑器">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="管理后台的报表页面，显示响应时间、CSAT 和 SLA 违规">
      </picture>
    </td>
    <td width="40%">
      <h3>一目了然的 SLA 和升级规则</h3>
      支持工作时间的响应和解决目标，在目标逾期时重新分配并发送通知的规则，以及违规报表。
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>开箱即用的客户门户</h3>
      客户可以在你的应用中提交工单、回复并查看状态。只需一个 script 标签即可把小部件嵌入到其他网站。
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="客户门户中的工单列表">
      </picture>
    </td>
  </tr>
</table>

## 功能

<table>
<tr>
<td width="33%" valign="top">

**工单与收件箱**
- 优先级、部门、标签和自定义字段
- 合并、关联和拆分工单
- 暂缓并自动唤醒
- 工单内的旁路对话
- 个人和共享的已保存视图
- 宏和预设回复

</td>
<td width="33%" valign="top">

**SLA 与分配**
- 响应和解决目标
- 支持工作时间
- SLA 违规时的升级规则
- 按客服设置的容量上限
- 基于技能的分配

</td>
<td width="33%" valign="top">

**客户**
- 带速率限制的小部件 API
- 来自小部件或邮件的公开工单
- 基于签名 Reply-To 的邮件会话串联
- 可配置的访客策略
- 基于令牌的访客访问
- 解决后的 CSAT 调查
- 支持搜索和评分的知识库

</td>
</tr>
<tr>
<td width="33%" valign="top">

**自动化**
- 基于工单和回复事件的 Workflows
- 定时 SLA 检查和暂缓唤醒
- 带重试的 HMAC 签名 webhook
- 可选的 Socket.IO 实时更新

</td>
<td width="33%" valign="top">

**访问与安全**
- 基于 Nest guards 的角色和权限
- 双因素认证（TOTP）
- 通过 SAML、OAuth 2 / OIDC 或 JWT 实现 SSO
- 带作用域权限的 Bearer API 令牌
- 记录每次变更的审计日志

</td>
<td width="33%" valign="top">

**扩展**
- 使用插件 SDK 构建的插件
- 批量导入工单、标签和部门
- 来自 @escalated-dev/locale 的翻译
- 可在应用中覆盖任意翻译

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">查看所有功能详情</a></sub></p>

<p align="center"><b>技术栈</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## 快速开始

```bash
npm install @escalated-dev/escalated-nestjs
```

然后在你的 `AppModule` 中添加 `EscalatedModule.forRoot()`，传入你自己的 `adminGuard`、`agentGuard` 和 `customerGuard`，并设置 `ui: { enabled: true }` 来提供界面（默认关闭）。需要 Node.js 22+、NestJS 11 和 TypeORM 0.3。[入门指南](../getting-started.md)介绍了所有选项。

## 了解更多

- [全部功能](../features.md) · [入门](../getting-started.md) · [界面（Inertia UI）](../ui.md)
- [API 参考](../api.md) · [事件与扩展点](../extending.md) · [Workflows](../workflows.md)
- [客服面板](../agent-panel.md) · [访问控制](../access-control.md) · [工单访问与分配](../ticket-access-and-routing.md)
- [嵌入小部件](../embedding-the-widget.md) · [嵌入管理后台](../embedding-admin.md) · [访客访问](../guest-access.md)
- [插件](../plugins.md) · [新闻通讯](../newsletters.md) · [开发](../development.md) · [依赖审计](../dependency-audit.md)

Escalated 也提供 [Laravel](https://github.com/escalated-dev/escalated-laravel)、[Rails](https://github.com/escalated-dev/escalated-rails)、[Django](https://github.com/escalated-dev/escalated-django)、[AdonisJS](https://github.com/escalated-dev/escalated-adonis)、[Symfony](https://github.com/escalated-dev/escalated-symfony)、[Phoenix](https://github.com/escalated-dev/escalated-phoenix)、[Go](https://github.com/escalated-dev/escalated-go)、[.NET](https://github.com/escalated-dev/escalated-dotnet)、[Spring](https://github.com/escalated-dev/escalated-spring)、[WordPress](https://github.com/escalated-dev/escalated-wordpress) 和 [Filament](https://github.com/escalated-dev/escalated-filament) 版本。UI 位于 [escalated](https://github.com/escalated-dev/escalated)。

## 许可证

MIT。Copyright (c) 2026 Escalated.dev。参见 [LICENSE](../../LICENSE)。
