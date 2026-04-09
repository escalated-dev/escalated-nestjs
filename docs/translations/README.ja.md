<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <a href="README.fr.md">Français</a> •
  <a href="README.it.md">Italiano</a> •
  <b>日本語</b> •
  <a href="README.ko.md">한국어</a> •
  <a href="README.nl.md">Nederlands</a> •
  <a href="README.pl.md">Polski</a> •
  <a href="README.pt-BR.md">Português (BR)</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.tr.md">Türkçe</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

NestJSアプリケーション向けの組み込みヘルプデスクモジュール。ドロップインチケッティング、SLA管理、ナレッジベースなど。

## 機能

- **Ticket Management** -- ライフサイクル追跡、優先度、部門、タグ、カスタムフィールドによる完全な管理
- **SLA Policies** -- 営業時間サポート付きの設定可能な応答/解決目標
- **Automations** -- `@nestjs/schedule`による時間ベースの処理（SLAチェック、スヌーズウェイクアップ、Webhookリトライ）
- **Escalation Rules** -- SLA違反時の自動再割り当てと通知
- **Macros & Canned Responses** -- ワンクリックのマルチアクションマクロとテンプレート返信
- **Custom Fields** -- バリデーション付きダイナミックフィールド（テキスト、数値、選択、チェックボックス、日付）
- **Knowledge Base** -- カテゴリ、検索、閲覧追跡、有用性評価付きの記事
- **Webhooks** -- 指数バックオフリトライ付きHMAC署名配信
- **API Tokens** -- スコープ付き機能のBearerトークン認証
- **Roles & Permissions** -- NestJSガード付きの細粒度パーミッションシステム
- **Audit Logging** -- すべての変更に対するインターセプターベースのアクティビティ追跡
- **Import System** -- チケット、タグ、部門の一括インポート
- **Side Conversations** -- チケット内のスレッドディスカッション
- **Ticket Merging & Linking** -- 重複の統合、関連チケットのリンク
- **Ticket Splitting** -- チケットを個別の問題に分割
- **Ticket Snooze** -- cronによる自動ウェイクアップ付きスヌーズ
- **Saved Views** -- 個人および共有フィルタービュー
- **Widget API** -- レート制限付きの埋め込み可能なサポートウィジェット用パブリックエンドポイント
- **Real-time Broadcasting** -- ライブ更新用Socket.IOゲートウェイ（オプトイン）
- **Capacity Management** -- リアルタイムトラッキング付きエージェントごとのチケット制限
- **Skill-based Routing** -- エージェントのスキルと空き状況に基づくチケット割り当て
- **CSAT Ratings** -- トークンベース送信による解決後の満足度調査
- **2FA (TOTP)** -- `otplib`によるエージェント向け二要素認証
- **Guest Access** -- 認証不要のトークンベースチケットアクセス

## 要件

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## インストール

```bash
npm install @escalated-dev/escalated-nestjs
```

## セットアップ

### 1. モジュールのインポート

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscalatedModule } from '@escalated-dev/escalated-nestjs';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      username: 'user',
      password: 'pass',
      autoLoadEntities: true,
      synchronize: true, // disable in production
    }),
    EscalatedModule.forRoot({
      routePrefix: 'escalated',
      appName: 'My App',
      appUrl: 'https://myapp.com',
      enableWebsockets: false,
      enableKnowledgeBase: true,
      enableCsat: true,
      enable2fa: false,
    }),
  ],
})
export class AppModule {}
```

### 2. 設定オプション

| Option                | Type       | Default       | 説明                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | すべてのルートのURLプレフィックス               |
| `enableWebsockets`    | `boolean`  | `false`       | Socket.IOリアルタイムブロードキャストを有効化 |
| `enableKnowledgeBase` | `boolean`  | `true`        | KB記事とカテゴリを有効化       |
| `enableCsat`          | `boolean`  | `true`        | 満足度調査を有効化             |
| `enable2fa`           | `boolean`  | `false`       | エージェント用TOTP 2FAを有効化              |
| `appName`             | `string`   | `'Escalated'` | メールのブランド名                |
| `appUrl`              | `string`   | --            | リンクのベースURL                      |
| `maxFileSize`         | `number`   | `10485760`    | 最大アップロードサイズ（バイト）                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhookリトライ回数                  |
| `widgetOrigins`       | `string[]` | `['*']`       | ウィジェットのCORSオリジン                 |
| `adminGuard`          | `class`    | --            | 管理者ルート用カスタムガード           |
| `agentGuard`          | `class`    | --            | エージェントルート用カスタムガード           |
| `customerGuard`       | `class`    | --            | 顧客ルート用カスタムガード        |
| `userResolver`        | `function` | --            | リクエストからユーザーを抽出               |

### 3. データベースマイグレーション

`synchronize: true`の場合、TypeORMは自動的にテーブルを作成します。本番環境では、マイグレーションを生成します：

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

競合を避けるため、すべてのテーブルに`escalated_`プレフィックスが付きます。

## APIエンドポイント

### Agent Routes (`/escalated/agent/`)

| メソッド | パス | 説明 |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | フィルター付きチケット一覧 |
| POST | `/tickets` | チケット作成 |
| GET | `/tickets/:id` | 返信付きチケット表示 |
| PUT | `/tickets/:id` | チケット更新 |
| DELETE | `/tickets/:id` | チケット削除 |
| POST | `/tickets/:id/replies` | 返信追加 |
| POST | `/tickets/:id/merge/:targetId` | チケット統合 |
| POST | `/tickets/:id/split` | チケット分割 |
| POST | `/tickets/:id/snooze` | チケットスヌーズ |
| GET | `/tickets/:ticketId/links` | チケットリンク一覧 |
| POST | `/tickets/:ticketId/links` | チケットリンク |
| GET | `/tickets/:ticketId/side-conversations` | サイドカンバセーション一覧 |
| POST | `/tickets/:ticketId/side-conversations` | サイドカンバセーション作成 |
| GET | `/macros` | マクロ一覧 |
| POST | `/macros/:macroId/execute/:ticketId` | マクロ実行 |
| GET | `/canned-responses` | 定型応答一覧 |
| GET | `/saved-views` | 保存済みビュー一覧 |
| POST | `/saved-views` | 保存済みビュー作成 |

### Admin Routes (`/escalated/admin/`)

| メソッド | パス | 説明 |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | 設定管理 |
| CRUD | `/departments` | 部門管理 |
| CRUD | `/tags` | タグ管理 |
| CRUD | `/custom-fields` | カスタムフィールド管理 |
| CRUD | `/roles` | ロール管理 |
| CRUD | `/sla/policies` | SLAポリシー管理 |
| CRUD | `/sla/escalation-rules` | エスカレーションルール管理 |
| CRUD | `/sla/schedules` | ビジネススケジュール管理 |
| CRUD | `/webhooks` | Webhook管理 |
| CRUD | `/api-tokens` | APIトークン管理 |
| CRUD | `/agents` | エージェントプロファイル管理 |
| CRUD | `/macros` | マクロ管理 |
| CRUD | `/canned-responses` | 定型応答管理 |
| CRUD | `/kb/categories` | KBカテゴリ管理 |
| CRUD | `/kb/articles` | KB記事管理 |
| POST | `/import/tickets` | チケット一括インポート |
| POST | `/2fa/generate` | 2FAシークレット生成 |
| POST | `/2fa/enable` | 2FA有効化 |
| GET | `/audit-logs` | 監査ログ表示 |

### Customer Routes (`/escalated/customer/`)

| メソッド | パス | 説明 |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | 自分のチケット一覧 |
| POST | `/tickets` | チケット作成 |
| GET | `/tickets/:id` | 自分のチケット表示 |
| POST | `/tickets/:id/replies` | 自分のチケットに返信 |
| POST | `/tickets/:id/rate` | CSAT評価送信 |
| GET | `/kb/categories` | KBカテゴリ閲覧 |
| GET | `/kb/articles` | KB記事閲覧 |
| GET | `/kb/search` | KB検索 |

### Widget Routes (`/escalated/widget/`)

| メソッド | パス | 説明 |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | チケット作成（公開） |
| GET | `/tickets/:id` | チケット表示（ゲストトークン） |
| POST | `/tickets/:id/replies` | 返信（ゲストトークン） |
| GET | `/kb/search` | KB検索 |
| POST | `/rate/:token` | CSAT送信 |

## サービスの直接使用

すべてのサービスはエクスポートされており、独自のコードにインジェクトできます：

```typescript
import { Injectable } from '@nestjs/common';
import { TicketService, AgentService } from '@escalated-dev/escalated-nestjs';

@Injectable()
export class MyService {
  constructor(
    private readonly ticketService: TicketService,
    private readonly agentService: AgentService,
  ) {}

  async assignToAvailableAgent(ticketId: number) {
    const agent = await this.agentService.findAvailableAgent();
    if (agent) {
      await this.ticketService.update(ticketId, { assigneeId: agent.userId }, 0);
    }
  }
}
```

## イベント

モジュールは`@nestjs/event-emitter`経由でイベントを発行します：

```typescript
import { OnEvent } from '@nestjs/event-emitter';
import { ESCALATED_EVENTS, TicketCreatedEvent } from '@escalated-dev/escalated-nestjs';

@Injectable()
export class NotificationService {
  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  handleTicketCreated(event: TicketCreatedEvent) {
    // Send notification, update external system, etc.
  }
}
```

Events: `TICKET_CREATED`, `TICKET_UPDATED`, `TICKET_ASSIGNED`, `TICKET_STATUS_CHANGED`, `TICKET_REPLY_CREATED`, `TICKET_MERGED`, `TICKET_SPLIT`, `SLA_BREACHED`.

## リアルタイム更新

ライブチケット更新のためのWebSocketブロードキャストを有効にします：

```typescript
EscalatedModule.forRoot({
  enableWebsockets: true,
});
```

Client-side (Socket.IO):

```javascript
const socket = io('/escalated');
socket.emit('join:ticket', { ticketId: 1 });
socket.on('ticket:updated', (data) => console.log('Updated:', data));
socket.on('ticket:reply', (data) => console.log('New reply:', data));
```

## 開発

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## TypeORMエンティティ

32のエンティティすべてがエクスポートされ、`escalated_`プレフィックスが付いています：

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## ライセンス

MIT
