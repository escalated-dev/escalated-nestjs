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
  <b>Türkçe</b> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

NestJS uygulamaları için gömülü yardım masası modülü. Hazır talep sistemi, SLA yönetimi, bilgi tabanı ve daha fazlası.

## Özellikler

- **Ticket Management** -- Yaşam döngüsü izleme, öncelikler, departmanlar, etiketler ve özel alanlarla tam yönetim
- **SLA Policies** -- Çalışma saatleri desteğiyle yapılandırılabilir yanıt/çözüm hedefleri
- **Automations** -- `@nestjs/schedule` aracılığıyla zamana dayalı işleme (SLA kontrolleri, erteleme uyandırma, webhook yeniden denemeleri)
- **Escalation Rules** -- SLA ihlalinde otomatik yeniden atama ve bildirimler
- **Macros & Canned Responses** -- Tek tıkla çok eylemli makrolar ve şablonlu yanıtlar
- **Custom Fields** -- Doğrulamalı dinamik alanlar (metin, sayı, seçim, onay kutusu, tarih)
- **Knowledge Base** -- Kategoriler, arama, görüntüleme izleme ve yararlılık derecelendirmeli makaleler
- **Webhooks** -- Üstel geri çekilme yeniden denemesiyle HMAC imzalı teslimat
- **API Tokens** -- Kapsamlı yeteneklerle Bearer token kimlik doğrulaması
- **Roles & Permissions** -- NestJS korumalarıyla ayrıntılı izin sistemi
- **Audit Logging** -- Tüm değişiklikler için interceptor tabanlı etkinlik izleme
- **Import System** -- Talepler, etiketler ve departmanlar için toplu içe aktarma
- **Side Conversations** -- Talep içinde iş parçacıklı tartışmalar
- **Ticket Merging & Linking** -- Yinelenenleri birleştirme, ilgili talepleri bağlama
- **Ticket Splitting** -- Talebi ayrı sorunlara bölme
- **Ticket Snooze** -- Cron aracılığıyla otomatik uyandırmalı erteleme
- **Saved Views** -- Kişisel ve paylaşılan filtrelenmiş görünümler
- **Widget API** -- Hız sınırlamalı gömülebilir destek widget'ı için genel uç noktalar
- **Real-time Broadcasting** -- Canlı güncellemeler için Socket.IO geçidi (isteğe bağlı)
- **Capacity Management** -- Gerçek zamanlı izlemeli temsilci başına talep limitleri
- **Skill-based Routing** -- Temsilci becerilerine ve uygunluğuna göre talep atama
- **CSAT Ratings** -- Token tabanlı gönderimle çözüm sonrası memnuniyet anketleri
- **2FA (TOTP)** -- `otplib` aracılığıyla temsilciler için iki faktörlü kimlik doğrulama
- **Guest Access** -- Kimlik doğrulaması olmadan token tabanlı talep erişimi

## Gereksinimler

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## Kurulum

```bash
npm install @escalated-dev/escalated-nestjs
```

## Kurulum

### 1. Modülü içe aktar

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

### 2. Yapılandırma seçenekleri

| Option                | Type       | Default       | Açıklama                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | Tüm rotalar için URL öneki               |
| `enableWebsockets`    | `boolean`  | `false`       | Socket.IO gerçek zamanlı yayını etkinleştir |
| `enableKnowledgeBase` | `boolean`  | `true`        | KB makaleleri ve kategorilerini etkinleştir       |
| `enableCsat`          | `boolean`  | `true`        | Memnuniyet anketlerini etkinleştir             |
| `enable2fa`           | `boolean`  | `false`       | Temsilciler için TOTP 2FA'yı etkinleştir              |
| `appName`             | `string`   | `'Escalated'` | E-postalar için marka adı                |
| `appUrl`              | `string`   | --            | Bağlantılar için temel URL                      |
| `maxFileSize`         | `number`   | `10485760`    | Bayt cinsinden maksimum yükleme boyutu                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhook yeniden deneme sayısı                  |
| `widgetOrigins`       | `string[]` | `['*']`       | Widget için CORS kökenleri                 |
| `adminGuard`          | `class`    | --            | Yönetici rotaları için özel koruma           |
| `agentGuard`          | `class`    | --            | Temsilci rotaları için özel koruma           |
| `customerGuard`       | `class`    | --            | Müşteri rotaları için özel koruma        |
| `userResolver`        | `function` | --            | İstekten kullanıcı çıkar               |

### 3. Veritabanı göçü

`synchronize: true` ile TypeORM tabloları otomatik oluşturur. Üretim için göç oluşturun:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

Çakışmaları önlemek için tüm tablolar `escalated_` önekine sahiptir.

## API Uç Noktaları

### Agent Routes (`/escalated/agent/`)

| Yöntem | Yol | Açıklama |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Filtrelerle talepleri listele |
| POST | `/tickets` | Talep oluştur |
| GET | `/tickets/:id` | Yanıtlarla talebi göster |
| PUT | `/tickets/:id` | Talebi güncelle |
| DELETE | `/tickets/:id` | Talebi sil |
| POST | `/tickets/:id/replies` | Yanıt ekle |
| POST | `/tickets/:id/merge/:targetId` | Talepleri birleştir |
| POST | `/tickets/:id/split` | Talebi böl |
| POST | `/tickets/:id/snooze` | Talebi ertele |
| GET | `/tickets/:ticketId/links` | Talep bağlantılarını listele |
| POST | `/tickets/:ticketId/links` | Talepleri bağla |
| GET | `/tickets/:ticketId/side-conversations` | Yan konuşmaları listele |
| POST | `/tickets/:ticketId/side-conversations` | Yan konuşma oluştur |
| GET | `/macros` | Makroları listele |
| POST | `/macros/:macroId/execute/:ticketId` | Makro çalıştır |
| GET | `/canned-responses` | Hazır yanıtları listele |
| GET | `/saved-views` | Kaydedilmiş görünümleri listele |
| POST | `/saved-views` | Kaydedilmiş görünüm oluştur |

### Admin Routes (`/escalated/admin/`)

| Yöntem | Yol | Açıklama |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | Ayarları yönet |
| CRUD | `/departments` | Departmanları yönet |
| CRUD | `/tags` | Etiketleri yönet |
| CRUD | `/custom-fields` | Özel alanları yönet |
| CRUD | `/roles` | Rolleri yönet |
| CRUD | `/sla/policies` | SLA politikalarını yönet |
| CRUD | `/sla/escalation-rules` | Yükseltme kurallarını yönet |
| CRUD | `/sla/schedules` | İş programlarını yönet |
| CRUD | `/webhooks` | Webhook'ları yönet |
| CRUD | `/api-tokens` | API tokenlarını yönet |
| CRUD | `/agents` | Temsilci profillerini yönet |
| CRUD | `/macros` | Makroları yönet |
| CRUD | `/canned-responses` | Hazır yanıtları yönet |
| CRUD | `/kb/categories` | KB kategorilerini yönet |
| CRUD | `/kb/articles` | KB makalelerini yönet |
| POST | `/import/tickets` | Toplu talep içe aktarma |
| POST | `/2fa/generate` | 2FA sırrı oluştur |
| POST | `/2fa/enable` | 2FA'yı etkinleştir |
| GET | `/audit-logs` | Denetim günlüklerini görüntüle |

### Customer Routes (`/escalated/customer/`)

| Yöntem | Yol | Açıklama |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | Kendi taleplerini listele |
| POST | `/tickets` | Talep oluştur |
| GET | `/tickets/:id` | Kendi talebini görüntüle |
| POST | `/tickets/:id/replies` | Kendi talebine yanıt ver |
| POST | `/tickets/:id/rate` | CSAT değerlendirmesi gönder |
| GET | `/kb/categories` | KB kategorilerini gözat |
| GET | `/kb/articles` | KB makalelerini gözat |
| GET | `/kb/search` | KB'de ara |

### Widget Routes (`/escalated/widget/`)

| Yöntem | Yol | Açıklama |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | Talep oluştur (genel) |
| GET | `/tickets/:id` | Talebi görüntüle (misafir tokeni) |
| POST | `/tickets/:id/replies` | Yanıtla (misafir tokeni) |
| GET | `/kb/search` | KB'de ara |
| POST | `/rate/:token` | CSAT gönder |

## Servisleri doğrudan kullanma

Tüm servisler dışa aktarılır ve kendi kodunuza enjekte edilebilir:

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

## Olaylar

Modül, `@nestjs/event-emitter` aracılığıyla olaylar yayar:

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

## Gerçek zamanlı güncellemeler

Canlı talep güncellemeleri için WebSocket yayınını etkinleştirin:

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

## Geliştirme

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## TypeORM Varlıkları

32 varlığın tamamı dışa aktarılır ve `escalated_` önekine sahiptir:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## Lisans

MIT
