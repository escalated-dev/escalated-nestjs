<p align="center">
  <b>العربية</b> •
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
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

وحدة مكتب مساعدة مضمنة لتطبيقات NestJS. نظام تذاكر جاهز للاستخدام وإدارة SLA وقاعدة معرفة والمزيد.

## الميزات

- **Ticket Management** -- إدارة كاملة مع تتبع دورة الحياة والأولويات والأقسام والعلامات والحقول المخصصة
- **SLA Policies** -- أهداف استجابة/حل قابلة للتكوين مع دعم ساعات العمل
- **Automations** -- معالجة مبنية على الوقت عبر `@nestjs/schedule` (فحوصات SLA، إيقاظ التأجيل، إعادة محاولة webhook)
- **Escalation Rules** -- إعادة تعيين تلقائية وإشعارات عند انتهاك SLA
- **Macros & Canned Responses** -- ماكرو متعدد الإجراءات بنقرة واحدة وردود نموذجية
- **Custom Fields** -- حقول ديناميكية مع تحقق (نص، رقم، اختيار، مربع اختيار، تاريخ)
- **Knowledge Base** -- مقالات مع فئات وبحث وتتبع المشاهدات وتقييمات المفيدية
- **Webhooks** -- تسليم موقّع بـ HMAC مع إعادة محاولة بتراجع أسي
- **API Tokens** -- مصادقة بالرمز Bearer مع صلاحيات محددة النطاق
- **Roles & Permissions** -- نظام أذونات دقيق مع حراس NestJS
- **Audit Logging** -- تتبع نشاط قائم على المعترض لجميع التعديلات
- **Import System** -- استيراد جماعي للتذاكر والعلامات والأقسام
- **Side Conversations** -- مناقشات مترابطة داخل التذكرة
- **Ticket Merging & Linking** -- دمج المكررات وربط التذاكر ذات الصلة
- **Ticket Splitting** -- تقسيم تذكرة إلى مشكلات منفصلة
- **Ticket Snooze** -- تأجيل مع إيقاظ تلقائي عبر cron
- **Saved Views** -- عروض شخصية ومشتركة مفلترة
- **Widget API** -- نقاط نهاية عامة لأداة دعم قابلة للتضمين مع تحديد معدل
- **Real-time Broadcasting** -- بوابة Socket.IO للتحديثات المباشرة (اختياري)
- **Capacity Management** -- حدود تذاكر لكل وكيل مع تتبع في الوقت الحقيقي
- **Skill-based Routing** -- تعيين التذاكر بناءً على مهارات الوكلاء وتوفرهم
- **CSAT Ratings** -- استبيانات رضا بعد الحل مع إرسال قائم على الرمز المميز
- **2FA (TOTP)** -- مصادقة ثنائية للوكلاء عبر `otplib`
- **Guest Access** -- وصول إلى التذاكر قائم على الرمز المميز بدون مصادقة

## المتطلبات

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## التثبيت

```bash
npm install @escalated-dev/escalated-nestjs
```

## الإعداد

### 1. استيراد الوحدة

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

### 2. خيارات التكوين

| Option                | Type       | Default       | الوصف                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | بادئة URL لجميع المسارات               |
| `enableWebsockets`    | `boolean`  | `false`       | تمكين بث Socket.IO في الوقت الحقيقي |
| `enableKnowledgeBase` | `boolean`  | `true`        | تمكين مقالات وفئات قاعدة المعرفة       |
| `enableCsat`          | `boolean`  | `true`        | تمكين استبيانات الرضا             |
| `enable2fa`           | `boolean`  | `false`       | تمكين TOTP 2FA للوكلاء              |
| `appName`             | `string`   | `'Escalated'` | اسم العلامة التجارية للبريد الإلكتروني                |
| `appUrl`              | `string`   | --            | عنوان URL الأساسي للروابط                      |
| `maxFileSize`         | `number`   | `10485760`    | الحد الأقصى لحجم الرفع بالبايت                |
| `webhookMaxRetries`   | `number`   | `3`           | محاولات إعادة المحاولة للـ Webhook                  |
| `widgetOrigins`       | `string[]` | `['*']`       | مصادر CORS للأداة                 |
| `adminGuard`          | `class`    | --            | حارس مخصص لمسارات المسؤول           |
| `agentGuard`          | `class`    | --            | حارس مخصص لمسارات الوكيل           |
| `customerGuard`       | `class`    | --            | حارس مخصص لمسارات العميل        |
| `userResolver`        | `function` | --            | استخراج المستخدم من الطلب               |

### 3. ترحيل قاعدة البيانات

مع `synchronize: true`، يقوم TypeORM بإنشاء الجداول تلقائياً. للإنتاج، قم بإنشاء ترحيلات:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

جميع الجداول مسبوقة بـ `escalated_` لتجنب التعارضات.

## نقاط نهاية API

### Agent Routes (`/escalated/agent/`)

| الطريقة | المسار | الوصف |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | عرض التذاكر مع فلاتر |
| POST | `/tickets` | إنشاء تذكرة |
| GET | `/tickets/:id` | عرض التذكرة مع الردود |
| PUT | `/tickets/:id` | تحديث تذكرة |
| DELETE | `/tickets/:id` | حذف تذكرة |
| POST | `/tickets/:id/replies` | إضافة رد |
| POST | `/tickets/:id/merge/:targetId` | دمج التذاكر |
| POST | `/tickets/:id/split` | تقسيم تذكرة |
| POST | `/tickets/:id/snooze` | تأجيل تذكرة |
| GET | `/tickets/:ticketId/links` | عرض روابط التذاكر |
| POST | `/tickets/:ticketId/links` | ربط التذاكر |
| GET | `/tickets/:ticketId/side-conversations` | عرض المحادثات الجانبية |
| POST | `/tickets/:ticketId/side-conversations` | إنشاء محادثة جانبية |
| GET | `/macros` | عرض الماكرو |
| POST | `/macros/:macroId/execute/:ticketId` | تنفيذ ماكرو |
| GET | `/canned-responses` | عرض الردود الجاهزة |
| GET | `/saved-views` | عرض العروض المحفوظة |
| POST | `/saved-views` | إنشاء عرض محفوظ |

### Admin Routes (`/escalated/admin/`)

| الطريقة | المسار | الوصف |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | إدارة الإعدادات |
| CRUD | `/departments` | إدارة الأقسام |
| CRUD | `/tags` | إدارة العلامات |
| CRUD | `/custom-fields` | إدارة الحقول المخصصة |
| CRUD | `/roles` | إدارة الأدوار |
| CRUD | `/sla/policies` | إدارة سياسات SLA |
| CRUD | `/sla/escalation-rules` | إدارة قواعد التصعيد |
| CRUD | `/sla/schedules` | إدارة جداول العمل |
| CRUD | `/webhooks` | إدارة Webhooks |
| CRUD | `/api-tokens` | إدارة رموز API |
| CRUD | `/agents` | إدارة ملفات الوكلاء |
| CRUD | `/macros` | إدارة الماكرو |
| CRUD | `/canned-responses` | إدارة الردود الجاهزة |
| CRUD | `/kb/categories` | إدارة فئات قاعدة المعرفة |
| CRUD | `/kb/articles` | إدارة مقالات قاعدة المعرفة |
| POST | `/import/tickets` | استيراد جماعي للتذاكر |
| POST | `/2fa/generate` | إنشاء سر 2FA |
| POST | `/2fa/enable` | تمكين 2FA |
| GET | `/audit-logs` | عرض سجلات التدقيق |

### Customer Routes (`/escalated/customer/`)

| الطريقة | المسار | الوصف |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | عرض التذاكر الخاصة |
| POST | `/tickets` | إنشاء تذكرة |
| GET | `/tickets/:id` | عرض تذكرة خاصة |
| POST | `/tickets/:id/replies` | الرد على تذكرة خاصة |
| POST | `/tickets/:id/rate` | إرسال تقييم CSAT |
| GET | `/kb/categories` | تصفح فئات قاعدة المعرفة |
| GET | `/kb/articles` | تصفح مقالات قاعدة المعرفة |
| GET | `/kb/search` | بحث في قاعدة المعرفة |

### Widget Routes (`/escalated/widget/`)

| الطريقة | المسار | الوصف |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | إنشاء تذكرة (عامة) |
| GET | `/tickets/:id` | عرض تذكرة (رمز ضيف) |
| POST | `/tickets/:id/replies` | الرد (رمز ضيف) |
| GET | `/kb/search` | بحث في قاعدة المعرفة |
| POST | `/rate/:token` | إرسال CSAT |

## استخدام الخدمات مباشرة

جميع الخدمات مُصدّرة ويمكن حقنها في الكود الخاص بك:

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

## الأحداث

تصدر الوحدة أحداثاً عبر `@nestjs/event-emitter`:

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

## التحديثات في الوقت الحقيقي

تمكين بث WebSocket لتحديثات التذاكر المباشرة:

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

## التطوير

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## كيانات TypeORM

جميع الكيانات الـ 32 مُصدّرة ومسبوقة بـ `escalated_`:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## الترخيص

MIT
