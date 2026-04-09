<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <a href="README.fr.md">Français</a> •
  <a href="README.it.md">Italiano</a> •
  <a href="README.ja.md">日本語</a> •
  <a href="README.ko.md">한국어</a> •
  <a href="README.nl.md">Nederlands</a> •
  <a href="README.pl.md">Polski</a> •
  <a href="README.pt-BR.md">Português (BR)</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.tr.md">Türkçe</a> •
  <b>简体中文</b>
</p>

# @escalated-dev/escalated-nestjs

NestJS 应用程序的嵌入式帮助台模块。即插即用的工单系统、SLA 管理、知识库等。

## 功能

- **Ticket Management** -- 通过生命周期跟踪、优先级、部门、标签和自定义字段实现完整管理
- **SLA Policies** -- 可配置的响应/解决目标，支持工作时间
- **Automations** -- 通过 `@nestjs/schedule` 进行基于时间的处理（SLA 检查、休眠唤醒、Webhook 重试）
- **Escalation Rules** -- SLA 违规时自动重新分配和通知
- **Macros & Canned Responses** -- 一键多操作宏和模板回复
- **Custom Fields** -- 带验证的动态字段（文本、数字、选择、复选框、日期）
- **Knowledge Base** -- 带分类、搜索、浏览跟踪和有用性评分的文章
- **Webhooks** -- 带指数退避重试的 HMAC 签名交付
- **API Tokens** -- 具有范围权限的 Bearer 令牌认证
- **Roles & Permissions** -- 使用 NestJS 守卫的细粒度权限系统
- **Audit Logging** -- 基于拦截器的所有变更活动跟踪
- **Import System** -- 工单、标签和部门的批量导入
- **Side Conversations** -- 工单内的线程讨论
- **Ticket Merging & Linking** -- 合并重复项，链接相关工单
- **Ticket Splitting** -- 将工单拆分为独立问题
- **Ticket Snooze** -- 通过 cron 自动唤醒的休眠
- **Saved Views** -- 个人和共享的过滤视图
- **Widget API** -- 带速率限制的可嵌入式支持小部件公共端点
- **Real-time Broadcasting** -- 用于实时更新的 Socket.IO 网关（可选启用）
- **Capacity Management** -- 带实时跟踪的每个客服人员工单限制
- **Skill-based Routing** -- 根据客服人员技能和可用性分配工单
- **CSAT Ratings** -- 基于令牌提交的解决后满意度调查
- **2FA (TOTP)** -- 通过 `otplib` 为客服人员提供双因素认证
- **Guest Access** -- 无需认证的基于令牌的工单访问

## 要求

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## 安装

```bash
npm install @escalated-dev/escalated-nestjs
```

## 设置

### 1. 导入模块

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

### 2. 配置选项

| Option                | Type       | Default       | 描述                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | 所有路由的 URL 前缀               |
| `enableWebsockets`    | `boolean`  | `false`       | 启用 Socket.IO 实时广播 |
| `enableKnowledgeBase` | `boolean`  | `true`        | 启用知识库文章和分类       |
| `enableCsat`          | `boolean`  | `true`        | 启用满意度调查             |
| `enable2fa`           | `boolean`  | `false`       | 为客服人员启用 TOTP 2FA              |
| `appName`             | `string`   | `'Escalated'` | 电子邮件品牌名称                |
| `appUrl`              | `string`   | --            | 链接的基本 URL                      |
| `maxFileSize`         | `number`   | `10485760`    | 最大上传大小（字节）                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhook 重试次数                  |
| `widgetOrigins`       | `string[]` | `['*']`       | 小部件的 CORS 来源                 |
| `adminGuard`          | `class`    | --            | 管理员路由的自定义守卫           |
| `agentGuard`          | `class`    | --            | 客服人员路由的自定义守卫           |
| `customerGuard`       | `class`    | --            | 客户路由的自定义守卫        |
| `userResolver`        | `function` | --            | 从请求中提取用户               |

### 3. 数据库迁移

使用 `synchronize: true` 时，TypeORM 会自动创建表。对于生产环境，请生成迁移：

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

所有表都以 `escalated_` 为前缀以避免冲突。

## API 端点

### Agent Routes (`/escalated/agent/`)

| 方法 | 路径 | 描述 |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | 列出带过滤器的工单 |
| POST | `/tickets` | 创建工单 |
| GET | `/tickets/:id` | 显示带回复的工单 |
| PUT | `/tickets/:id` | 更新工单 |
| DELETE | `/tickets/:id` | 删除工单 |
| POST | `/tickets/:id/replies` | 添加回复 |
| POST | `/tickets/:id/merge/:targetId` | 合并工单 |
| POST | `/tickets/:id/split` | 拆分工单 |
| POST | `/tickets/:id/snooze` | 休眠工单 |
| GET | `/tickets/:ticketId/links` | 列出工单链接 |
| POST | `/tickets/:ticketId/links` | 链接工单 |
| GET | `/tickets/:ticketId/side-conversations` | 列出侧边对话 |
| POST | `/tickets/:ticketId/side-conversations` | 创建侧边对话 |
| GET | `/macros` | 列出宏 |
| POST | `/macros/:macroId/execute/:ticketId` | 执行宏 |
| GET | `/canned-responses` | 列出预设回复 |
| GET | `/saved-views` | 列出已保存视图 |
| POST | `/saved-views` | 创建已保存视图 |

### Admin Routes (`/escalated/admin/`)

| 方法 | 路径 | 描述 |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | 管理设置 |
| CRUD | `/departments` | 管理部门 |
| CRUD | `/tags` | 管理标签 |
| CRUD | `/custom-fields` | 管理自定义字段 |
| CRUD | `/roles` | 管理角色 |
| CRUD | `/sla/policies` | 管理 SLA 策略 |
| CRUD | `/sla/escalation-rules` | 管理升级规则 |
| CRUD | `/sla/schedules` | 管理业务日程 |
| CRUD | `/webhooks` | 管理 Webhooks |
| CRUD | `/api-tokens` | 管理 API 令牌 |
| CRUD | `/agents` | 管理客服人员资料 |
| CRUD | `/macros` | 管理宏 |
| CRUD | `/canned-responses` | 管理预设回复 |
| CRUD | `/kb/categories` | 管理知识库分类 |
| CRUD | `/kb/articles` | 管理知识库文章 |
| POST | `/import/tickets` | 批量导入工单 |
| POST | `/2fa/generate` | 生成 2FA 密钥 |
| POST | `/2fa/enable` | 启用 2FA |
| GET | `/audit-logs` | 查看审计日志 |

### Customer Routes (`/escalated/customer/`)

| 方法 | 路径 | 描述 |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | 列出自己的工单 |
| POST | `/tickets` | 创建工单 |
| GET | `/tickets/:id` | 查看自己的工单 |
| POST | `/tickets/:id/replies` | 回复自己的工单 |
| POST | `/tickets/:id/rate` | 提交 CSAT 评分 |
| GET | `/kb/categories` | 浏览知识库分类 |
| GET | `/kb/articles` | 浏览知识库文章 |
| GET | `/kb/search` | 搜索知识库 |

### Widget Routes (`/escalated/widget/`)

| 方法 | 路径 | 描述 |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | 创建工单（公开） |
| GET | `/tickets/:id` | 查看工单（访客令牌） |
| POST | `/tickets/:id/replies` | 回复（访客令牌） |
| GET | `/kb/search` | 搜索知识库 |
| POST | `/rate/:token` | 提交 CSAT |

## 直接使用服务

所有服务均已导出，可以注入到您自己的代码中：

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

## 事件

该模块通过 `@nestjs/event-emitter` 发出事件：

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

## 实时更新

启用 WebSocket 广播以实现实时工单更新：

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

## 开发

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## TypeORM 实体

所有 32 个实体均已导出并以 `escalated_` 为前缀：

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## 许可证

MIT
