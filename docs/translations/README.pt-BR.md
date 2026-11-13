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
  <b>Português (BR)</b> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</sub></p>

<p align="center">
  <a href="https://escalated.dev"><img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/logo.png" width="72" height="72" alt="Escalated"></a>
</p>

<h1 align="center">Escalated for NestJS</h1>

<p align="center">
  Adicione um helpdesk completo ao seu app NestJS.<br>
  Tickets, SLAs, regras de escalonamento, uma caixa de entrada para agentes e um portal do cliente, rodando no seu próprio banco de dados.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Site</b></a> ·
  <a href="https://escalated.dev/docs"><b>Documentação</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Histórico de mudanças</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="A caixa de entrada de agentes do Escalated: visualizações salvas com contagens, contagem regressiva de SLA e prioridades em cada ticket" width="100%">
</picture>

## O que ele faz

<table>
  <tr>
    <td width="40%">
      <h3>Uma caixa de entrada onde seus agentes trabalham o dia todo</h3>
      Conversa, notas internas, respostas prontas e timers de SLA em uma só tela. Tickets também chegam por e-mail via Postmark, Mailgun ou SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Um ticket aberto no espaço de trabalho do agente com o editor de resposta">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="A página de relatórios do admin com tempos de resposta, CSAT e violações de SLA">
      </picture>
    </td>
    <td width="40%">
      <h3>SLAs e regras de escalonamento que você consegue ver</h3>
      Metas de resposta e resolução com horário comercial, regras que reatribuem e notificam quando uma meta é perdida, e relatórios de violações.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Um portal do cliente que já vem pronto</h3>
      Clientes abrem tickets, respondem e acompanham o status pelo seu app. Incorpore o widget em outros sites com uma única tag script.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="A lista de tickets do portal do cliente">
      </picture>
    </td>
  </tr>
</table>

## Recursos

<table>
<tr>
<td width="33%" valign="top">

**Tickets e caixa de entrada**
- Prioridades, departamentos, tags e campos personalizados
- Mesclar, vincular e dividir tickets
- Adiar com reativação automática
- Conversas paralelas dentro de um ticket
- Visualizações salvas pessoais e compartilhadas
- Macros e respostas prontas

</td>
<td width="33%" valign="top">

**SLAs e roteamento**
- Metas de resposta e resolução
- Suporte a horário comercial
- Regras de escalonamento em violação de SLA
- Limites de capacidade por agente
- Roteamento por habilidades

</td>
<td width="33%" valign="top">

**Clientes**
- API do widget com limite de requisições
- Tickets públicos pelo widget ou por e-mail
- Encadeamento de e-mail com Reply-To assinado
- Política de convidados configurável
- Acesso de convidados por token
- Pesquisas CSAT após a resolução
- Base de conhecimento com busca e avaliações

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Automação**
- Workflows em eventos de ticket e resposta
- Verificações de SLA agendadas e reativação de adiados
- Webhooks assinados com HMAC e novas tentativas
- Atualizações em tempo real opcionais via Socket.IO

</td>
<td width="33%" valign="top">

**Acesso e segurança**
- Papéis e permissões com guards do Nest
- Autenticação em dois fatores (TOTP)
- SSO com SAML, OAuth 2 / OIDC ou JWT
- Tokens de API Bearer com permissões limitadas
- Log de auditoria de cada alteração

</td>
<td width="33%" valign="top">

**Extensão**
- Plugins criados com o plugin SDK
- Importação em massa de tickets, tags e departamentos
- Traduções de @escalated-dev/locale
- Sobrescreva qualquer tradução no seu app

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Todos os recursos em detalhe</a></sub></p>

<p align="center"><b>Feito com</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Início rápido

```bash
npm install @escalated-dev/escalated-nestjs
```

Depois adicione `EscalatedModule.forRoot()` ao seu `AppModule` com seus próprios `adminGuard`, `agentGuard` e `customerGuard`, e defina `ui: { enabled: true }` para servir as telas (elas vêm desativadas por padrão). Requer Node.js 22+, NestJS 11 e TypeORM 0.3. O [guia de primeiros passos](../getting-started.md) cobre todas as opções.

## Saiba mais

- [Todos os recursos](../features.md) · [Primeiros passos](../getting-started.md) · [As telas (Inertia UI)](../ui.md)
- [Referência da API](../api.md) · [Eventos e pontos de extensão](../extending.md) · [Workflows](../workflows.md)
- [Painel do agente](../agent-panel.md) · [Controle de acesso](../access-control.md) · [Acesso a tickets e roteamento](../ticket-access-and-routing.md)
- [Incorporar o widget](../embedding-the-widget.md) · [Incorporar o admin](../embedding-admin.md) · [Acesso de convidados](../guest-access.md)
- [Plugins](../plugins.md) · [Newsletters](../newsletters.md) · [Desenvolvimento](../development.md) · [Auditoria de dependências](../dependency-audit.md)

O Escalated também está disponível para [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) e [Filament](https://github.com/escalated-dev/escalated-filament). A interface fica em [escalated](https://github.com/escalated-dev/escalated).

## Licença

MIT. Copyright (c) 2026 Escalated.dev. Veja [LICENSE](../../LICENSE).
