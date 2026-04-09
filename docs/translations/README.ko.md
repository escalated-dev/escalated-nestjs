<p align="center">
  <a href="README.ar.md">العربية</a> •
  <a href="README.de.md">Deutsch</a> •
  <a href="../../README.md">English</a> •
  <a href="README.es.md">Español</a> •
  <a href="README.fr.md">Français</a> •
  <a href="README.it.md">Italiano</a> •
  <a href="README.ja.md">日本語</a> •
  <b>한국어</b> •
  <a href="README.nl.md">Nederlands</a> •
  <a href="README.pl.md">Polski</a> •
  <a href="README.pt-BR.md">Português (BR)</a> •
  <a href="README.ru.md">Русский</a> •
  <a href="README.tr.md">Türkçe</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

# @escalated-dev/escalated-nestjs

NestJS 애플리케이션을 위한 내장 헬프데스크 모듈. 드롭인 티켓팅, SLA 관리, 지식 베이스 등.

## 기능

- **Ticket Management** -- 라이프사이클 추적, 우선순위, 부서, 태그, 사용자 정의 필드를 통한 완전한 관리
- **SLA Policies** -- 영업 시간 지원을 포함한 구성 가능한 응답/해결 목표
- **Automations** -- `@nestjs/schedule`를 통한 시간 기반 처리 (SLA 검사, 스누즈 깨우기, Webhook 재시도)
- **Escalation Rules** -- SLA 위반 시 자동 재할당 및 알림
- **Macros & Canned Responses** -- 원클릭 다중 작업 매크로 및 템플릿 답변
- **Custom Fields** -- 유효성 검사가 포함된 동적 필드 (텍스트, 숫자, 선택, 체크박스, 날짜)
- **Knowledge Base** -- 카테고리, 검색, 조회 추적, 유용성 평가가 포함된 기사
- **Webhooks** -- 지수 백오프 재시도를 포함한 HMAC 서명 전달
- **API Tokens** -- 범위 지정된 기능의 Bearer 토큰 인증
- **Roles & Permissions** -- NestJS 가드를 포함한 세분화된 권한 시스템
- **Audit Logging** -- 모든 변경에 대한 인터셉터 기반 활동 추적
- **Import System** -- 티켓, 태그, 부서 대량 가져오기
- **Side Conversations** -- 티켓 내 스레드 토론
- **Ticket Merging & Linking** -- 중복 병합, 관련 티켓 연결
- **Ticket Splitting** -- 티켓을 별도의 이슈로 분할
- **Ticket Snooze** -- cron을 통한 자동 깨우기 스누즈
- **Saved Views** -- 개인 및 공유 필터 뷰
- **Widget API** -- 속도 제한이 포함된 내장형 지원 위젯용 공개 엔드포인트
- **Real-time Broadcasting** -- 실시간 업데이트용 Socket.IO 게이트웨이 (옵트인)
- **Capacity Management** -- 실시간 추적이 포함된 에이전트당 티켓 제한
- **Skill-based Routing** -- 에이전트 스킬 및 가용성에 기반한 티켓 할당
- **CSAT Ratings** -- 토큰 기반 제출을 통한 해결 후 만족도 설문
- **2FA (TOTP)** -- `otplib`를 통한 에이전트 2단계 인증
- **Guest Access** -- 인증 없는 토큰 기반 티켓 접근

## 요구 사항

- Node.js 18+
- NestJS 10+
- TypeORM 0.3+
- Any TypeORM-supported database (PostgreSQL, MySQL, SQLite, etc.)

## 설치

```bash
npm install @escalated-dev/escalated-nestjs
```

## 설정

### 1. 모듈 가져오기

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

### 2. 구성 옵션

| Option                | Type       | Default       | 설명                             |
| --------------------- | ---------- | ------------- | --------------------------------------- |
| `routePrefix`         | `string`   | `'escalated'` | 모든 경로의 URL 접두사               |
| `enableWebsockets`    | `boolean`  | `false`       | Socket.IO 실시간 브로드캐스팅 활성화 |
| `enableKnowledgeBase` | `boolean`  | `true`        | KB 기사 및 카테고리 활성화       |
| `enableCsat`          | `boolean`  | `true`        | 만족도 설문 활성화             |
| `enable2fa`           | `boolean`  | `false`       | 에이전트용 TOTP 2FA 활성화              |
| `appName`             | `string`   | `'Escalated'` | 이메일 브랜드 이름                |
| `appUrl`              | `string`   | --            | 링크 기본 URL                      |
| `maxFileSize`         | `number`   | `10485760`    | 최대 업로드 크기 (바이트)                |
| `webhookMaxRetries`   | `number`   | `3`           | Webhook 재시도 횟수                  |
| `widgetOrigins`       | `string[]` | `['*']`       | 위젯 CORS 출처                 |
| `adminGuard`          | `class`    | --            | 관리자 경로용 커스텀 가드           |
| `agentGuard`          | `class`    | --            | 에이전트 경로용 커스텀 가드           |
| `customerGuard`       | `class`    | --            | 고객 경로용 커스텀 가드        |
| `userResolver`        | `function` | --            | 요청에서 사용자 추출               |

### 3. 데이터베이스 마이그레이션

`synchronize: true`일 때 TypeORM이 자동으로 테이블을 생성합니다. 프로덕션 환경에서는 마이그레이션을 생성합니다:

```bash
npx typeorm migration:generate -n EscalatedSetup
npx typeorm migration:run
```

충돌을 피하기 위해 모든 테이블에 `escalated_` 접두사가 붙습니다.

## API 엔드포인트

### Agent Routes (`/escalated/agent/`)

| 메서드 | 경로 | 설명 |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | 필터 포함 티켓 목록 |
| POST | `/tickets` | 티켓 생성 |
| GET | `/tickets/:id` | 답변 포함 티켓 표시 |
| PUT | `/tickets/:id` | 티켓 수정 |
| DELETE | `/tickets/:id` | 티켓 삭제 |
| POST | `/tickets/:id/replies` | 답변 추가 |
| POST | `/tickets/:id/merge/:targetId` | 티켓 병합 |
| POST | `/tickets/:id/split` | 티켓 분할 |
| POST | `/tickets/:id/snooze` | 티켓 스누즈 |
| GET | `/tickets/:ticketId/links` | 티켓 링크 목록 |
| POST | `/tickets/:ticketId/links` | 티켓 연결 |
| GET | `/tickets/:ticketId/side-conversations` | 사이드 대화 목록 |
| POST | `/tickets/:ticketId/side-conversations` | 사이드 대화 생성 |
| GET | `/macros` | 매크로 목록 |
| POST | `/macros/:macroId/execute/:ticketId` | 매크로 실행 |
| GET | `/canned-responses` | 정형 응답 목록 |
| GET | `/saved-views` | 저장된 뷰 목록 |
| POST | `/saved-views` | 저장된 뷰 생성 |

### Admin Routes (`/escalated/admin/`)

| 메서드 | 경로 | 설명 |
| ------ | --------------------------------------- | ------------------------- |
| GET/PUT | `/settings` | 설정 관리 |
| CRUD | `/departments` | 부서 관리 |
| CRUD | `/tags` | 태그 관리 |
| CRUD | `/custom-fields` | 사용자 정의 필드 관리 |
| CRUD | `/roles` | 역할 관리 |
| CRUD | `/sla/policies` | SLA 정책 관리 |
| CRUD | `/sla/escalation-rules` | 에스컬레이션 규칙 관리 |
| CRUD | `/sla/schedules` | 업무 일정 관리 |
| CRUD | `/webhooks` | Webhook 관리 |
| CRUD | `/api-tokens` | API 토큰 관리 |
| CRUD | `/agents` | 에이전트 프로필 관리 |
| CRUD | `/macros` | 매크로 관리 |
| CRUD | `/canned-responses` | 정형 응답 관리 |
| CRUD | `/kb/categories` | KB 카테고리 관리 |
| CRUD | `/kb/articles` | KB 기사 관리 |
| POST | `/import/tickets` | 티켓 대량 가져오기 |
| POST | `/2fa/generate` | 2FA 비밀 생성 |
| POST | `/2fa/enable` | 2FA 활성화 |
| GET | `/audit-logs` | 감사 로그 보기 |

### Customer Routes (`/escalated/customer/`)

| 메서드 | 경로 | 설명 |
| ------ | --------------------------------------- | ------------------------- |
| GET | `/tickets` | 자신의 티켓 목록 |
| POST | `/tickets` | 티켓 생성 |
| GET | `/tickets/:id` | 자신의 티켓 보기 |
| POST | `/tickets/:id/replies` | 자신의 티켓에 답변 |
| POST | `/tickets/:id/rate` | CSAT 평가 제출 |
| GET | `/kb/categories` | KB 카테고리 탐색 |
| GET | `/kb/articles` | KB 기사 탐색 |
| GET | `/kb/search` | KB 검색 |

### Widget Routes (`/escalated/widget/`)

| 메서드 | 경로 | 설명 |
| ------ | --------------------------------------- | ------------------------- |
| POST | `/tickets` | 티켓 생성 (공개) |
| GET | `/tickets/:id` | 티켓 보기 (게스트 토큰) |
| POST | `/tickets/:id/replies` | 답변 (게스트 토큰) |
| GET | `/kb/search` | KB 검색 |
| POST | `/rate/:token` | CSAT 제출 |

## 서비스 직접 사용

모든 서비스가 내보내져 있으며 자체 코드에 주입할 수 있습니다:

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

## 이벤트

모듈은 `@nestjs/event-emitter`를 통해 이벤트를 발생시킵니다:

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

## 실시간 업데이트

실시간 티켓 업데이트를 위한 WebSocket 브로드캐스팅을 활성화합니다:

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

## 개발

```bash
git clone https://github.com/escalated-dev/escalated-nestjs.git
cd escalated-nestjs
npm install --legacy-peer-deps
npm test
npm run build
```

## TypeORM 엔티티

32개의 모든 엔티티가 내보내지며 `escalated_` 접두사가 붙습니다:

**Core:** Ticket, TicketStatus, Reply, Attachment, TicketActivity, Tag, Department, TicketLink, SatisfactionRating

**SLA:** SlaPolicy, EscalationRule, BusinessSchedule, Holiday

**Agents:** AgentProfile, AgentCapacity, Skill

**Messaging:** CannedResponse, Macro, SideConversation, SideConversationReply

**Admin:** Role, Permission, ApiToken, Webhook, WebhookDelivery, AuditLog

**Custom:** CustomField, CustomFieldValue

**Config:** EscalatedSettings, SavedView

**Knowledge Base:** KbCategory, KbArticle

## 라이선스

MIT
