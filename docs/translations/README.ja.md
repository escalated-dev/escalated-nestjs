<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="../../README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.it.md">Italiano</a> ·
  <b>日本語</b> ·
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
  NestJS アプリに本格的なヘルプデスクを追加できます。<br>
  チケット、SLA、エスカレーションルール、エージェント用受信トレイ、カスタマーポータルが、あなた自身のデータベース上で動きます。
</p>

<p align="center">
  <a href="https://escalated.dev"><b>ウェブサイト</b></a> ·
  <a href="https://escalated.dev/docs"><b>ドキュメント</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>変更履歴</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="Escalated のエージェント用受信トレイ: 件数付きの保存済みビュー、各チケットの SLA カウントダウンと優先度" width="100%">
</picture>

## できること

<table>
  <tr>
    <td width="40%">
      <h3>エージェントが一日中使える受信トレイ</h3>
      会話、内部メモ、定型返信、SLA タイマーをひとつの画面に。チケットは Postmark、Mailgun、SES 経由のメールでも届きます。
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="エージェントのワークスペースで開いたチケットと返信エディタ">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="応答時間、CSAT、SLA 違反を表示する管理者用レポートページ">
      </picture>
    </td>
    <td width="40%">
      <h3>状況が見える SLA とエスカレーションルール</h3>
      営業時間を考慮した応答・解決目標、目標を外れたときに再割り当てと通知を行うルール、違反に関するレポート。
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>すぐに使えるカスタマーポータル</h3>
      顧客はあなたのアプリからチケットを作成し、返信し、状況を確認できます。script タグひとつで他のサイトにウィジェットを埋め込めます。
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="カスタマーポータルのチケット一覧">
      </picture>
    </td>
  </tr>
</table>

## 機能

<table>
<tr>
<td width="33%" valign="top">

**チケットと受信トレイ**
- 優先度、部署、タグ、カスタムフィールド
- チケットの統合、リンク、分割
- 自動再開付きのスヌーズ
- チケット内のサイド会話
- 個人用と共有の保存済みビュー
- マクロと定型返信

</td>
<td width="33%" valign="top">

**SLA とルーティング**
- 応答目標と解決目標
- 営業時間のサポート
- SLA 違反時のエスカレーションルール
- エージェントごとの対応上限
- スキルベースのルーティング

</td>
<td width="33%" valign="top">

**顧客**
- レート制限付きのウィジェット API
- ウィジェットやメールからの公開チケット
- 署名付き Reply-To によるメールのスレッド化
- 設定可能なゲストポリシー
- トークンによるゲストアクセス
- 解決後の CSAT アンケート
- 検索と評価に対応したナレッジベース

</td>
</tr>
<tr>
<td width="33%" valign="top">

**自動化**
- チケットと返信のイベントで動く Workflow
- 定期的な SLA チェックとスヌーズの再開
- 再試行付きの HMAC 署名 Webhook
- Socket.IO によるリアルタイム更新(オプトイン)

</td>
<td width="33%" valign="top">

**アクセスとセキュリティ**
- Nest のガードによるロールと権限
- 二要素認証 (TOTP)
- SAML、OAuth 2 / OIDC、JWT による SSO
- 権限を絞れる Bearer API トークン
- すべての変更の監査ログ

</td>
<td width="33%" valign="top">

**拡張**
- プラグイン SDK で作るプラグイン
- チケット、タグ、部署の一括インポート
- @escalated-dev/locale による翻訳
- どの翻訳もアプリ側で上書き可能

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">すべての機能の詳細</a></sub></p>

<p align="center"><b>使用技術</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## クイックスタート

```bash
npm install @escalated-dev/escalated-nestjs
```

次に、独自の `adminGuard`、`agentGuard`、`customerGuard` を指定して `EscalatedModule.forRoot()` を `AppModule` に追加し、画面を配信するために `ui: { enabled: true }` を設定します(デフォルトでは無効です)。Node.js 22+、NestJS 11、TypeORM 0.3 が必要です。すべてのオプションは[スタートガイド](../getting-started.md)で説明しています。

## 詳しく知る

- [すべての機能](../features.md) · [はじめに](../getting-started.md) · [画面 (Inertia UI)](../ui.md)
- [API リファレンス](../api.md) · [イベントと拡張ポイント](../extending.md) · [Workflow](../workflows.md)
- [エージェントパネル](../agent-panel.md) · [アクセス制御](../access-control.md) · [チケットのアクセスとルーティング](../ticket-access-and-routing.md)
- [ウィジェットの埋め込み](../embedding-the-widget.md) · [管理画面の埋め込み](../embedding-admin.md) · [ゲストアクセス](../guest-access.md)
- [プラグイン](../plugins.md) · [ニュースレター](../newsletters.md) · [開発](../development.md) · [依存関係の監査](../dependency-audit.md)

Escalated は [Laravel](https://github.com/escalated-dev/escalated-laravel)、[Rails](https://github.com/escalated-dev/escalated-rails)、[Django](https://github.com/escalated-dev/escalated-django)、[AdonisJS](https://github.com/escalated-dev/escalated-adonis)、[Symfony](https://github.com/escalated-dev/escalated-symfony)、[Phoenix](https://github.com/escalated-dev/escalated-phoenix)、[Go](https://github.com/escalated-dev/escalated-go)、[.NET](https://github.com/escalated-dev/escalated-dotnet)、[Spring](https://github.com/escalated-dev/escalated-spring)、[WordPress](https://github.com/escalated-dev/escalated-wordpress)、[Filament](https://github.com/escalated-dev/escalated-filament) 向けにも提供しています。UI は [escalated](https://github.com/escalated-dev/escalated) にあります。

## ライセンス

MIT。Copyright (c) 2026 Escalated.dev。[LICENSE](../../LICENSE) を参照してください。
