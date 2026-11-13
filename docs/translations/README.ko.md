<p align="center"><sub>
  <a href="README.ar.md">العربية</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="../../README.md">English</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.it.md">Italiano</a> ·
  <a href="README.ja.md">日本語</a> ·
  <b>한국어</b> ·
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
  NestJS 앱에 완전한 헬프데스크를 추가하세요.<br>
  티켓, SLA, 에스컬레이션 규칙, 상담원 받은편지함, 고객 포털이 여러분의 데이터베이스에서 동작합니다.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>웹사이트</b></a> ·
  <a href="https://escalated.dev/docs"><b>문서</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>변경 내역</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="Escalated 상담원 받은편지함: 개수가 표시된 저장된 보기, 모든 티켓의 SLA 카운트다운과 우선순위" width="100%">
</picture>

## 하는 일

<table>
  <tr>
    <td width="40%">
      <h3>상담원이 하루 종일 일할 수 있는 받은편지함</h3>
      대화, 내부 메모, 저장된 답변, SLA 타이머를 한 화면에서. 티켓은 Postmark, Mailgun, SES를 통한 이메일로도 들어옵니다.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="상담원 작업 공간에서 열린 티켓과 답장 작성기">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="응답 시간, CSAT, SLA 위반을 보여 주는 관리자 보고서 페이지">
      </picture>
    </td>
    <td width="40%">
      <h3>한눈에 보이는 SLA와 에스컬레이션 규칙</h3>
      업무 시간을 반영한 응답 및 해결 목표, 목표를 놓치면 재할당하고 알리는 규칙, 위반 보고서.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>이미 만들어진 고객 포털</h3>
      고객은 여러분의 앱에서 티켓을 열고, 답장하고, 상태를 확인합니다. script 태그 하나로 다른 사이트에 위젯을 삽입할 수 있습니다.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="고객 포털의 티켓 목록">
      </picture>
    </td>
  </tr>
</table>

## 기능

<table>
<tr>
<td width="33%" valign="top">

**티켓과 받은편지함**
- 우선순위, 부서, 태그, 사용자 정의 필드
- 티켓 병합, 연결, 분할
- 자동 재개가 있는 스누즈
- 티켓 안의 사이드 대화
- 개인 및 공유 저장된 보기
- 매크로와 저장된 답변

</td>
<td width="33%" valign="top">

**SLA와 라우팅**
- 응답 및 해결 목표
- 업무 시간 지원
- SLA 위반 시 에스컬레이션 규칙
- 상담원별 처리 한도
- 스킬 기반 라우팅

</td>
<td width="33%" valign="top">

**고객**
- 요청 제한이 있는 위젯 API
- 위젯이나 이메일로 들어오는 공개 티켓
- 서명된 Reply-To를 이용한 이메일 스레딩
- 설정 가능한 게스트 정책
- 토큰 기반 게스트 접근
- 해결 후 CSAT 설문
- 검색과 평가를 지원하는 지식 베이스

</td>
</tr>
<tr>
<td width="33%" valign="top">

**자동화**
- 티켓 및 답장 이벤트에 반응하는 Workflow
- 예약된 SLA 점검과 스누즈 재개
- 재시도가 포함된 HMAC 서명 웹훅
- Socket.IO를 통한 선택적 실시간 업데이트

</td>
<td width="33%" valign="top">

**접근 및 보안**
- Nest 가드를 이용한 역할과 권한
- 2단계 인증 (TOTP)
- SAML, OAuth 2 / OIDC 또는 JWT를 이용한 SSO
- 범위가 지정된 Bearer API 토큰
- 모든 변경에 대한 감사 로그

</td>
<td width="33%" valign="top">

**확장**
- 플러그인 SDK로 만드는 플러그인
- 티켓, 태그, 부서 일괄 가져오기
- @escalated-dev/locale의 번역
- 앱에서 어떤 번역이든 재정의 가능

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">모든 기능 자세히 보기</a></sub></p>

<p align="center"><b>사용 기술</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## 빠른 시작

```bash
npm install @escalated-dev/escalated-nestjs
```

그런 다음 직접 만든 `adminGuard`, `agentGuard`, `customerGuard`와 함께 `EscalatedModule.forRoot()`를 `AppModule`에 추가하고, 화면을 제공하려면 `ui: { enabled: true }`를 설정하세요(기본값은 꺼져 있습니다). Node.js 22+, NestJS 11, TypeORM 0.3이 필요합니다. 모든 옵션은 [시작 가이드](../getting-started.md)에서 설명합니다.

## 더 알아보기

- [모든 기능](../features.md) · [시작하기](../getting-started.md) · [화면 (Inertia UI)](../ui.md)
- [API 레퍼런스](../api.md) · [이벤트와 확장 지점](../extending.md) · [Workflow](../workflows.md)
- [상담원 패널](../agent-panel.md) · [접근 제어](../access-control.md) · [티켓 접근과 라우팅](../ticket-access-and-routing.md)
- [위젯 삽입하기](../embedding-the-widget.md) · [관리자 화면 삽입하기](../embedding-admin.md) · [게스트 접근](../guest-access.md)
- [플러그인](../plugins.md) · [뉴스레터](../newsletters.md) · [개발](../development.md) · [의존성 감사](../dependency-audit.md)

Escalated는 [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress), [Filament](https://github.com/escalated-dev/escalated-filament)용으로도 제공됩니다. UI는 [escalated](https://github.com/escalated-dev/escalated)에 있습니다.

## 라이선스

MIT. Copyright (c) 2026 Escalated.dev. [LICENSE](../../LICENSE)를 참고하세요.
