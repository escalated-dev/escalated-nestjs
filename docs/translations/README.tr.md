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
  <b>Türkçe</b> ·
  <a href="README.zh-CN.md">简体中文</a>
</sub></p>

<p align="center">
  <a href="https://escalated.dev"><img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/logo.png" width="72" height="72" alt="Escalated"></a>
</p>

<h1 align="center">Escalated for NestJS</h1>

<p align="center">
  NestJS uygulamana eksiksiz bir yardım masası ekle.<br>
  Talepler, SLA'lar, eskalasyon kuralları, temsilci gelen kutusu ve müşteri portalı, hepsi kendi veritabanında çalışır.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>Web sitesi</b></a> ·
  <a href="https://escalated.dev/docs"><b>Dokümantasyon</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>Değişiklik günlüğü</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="Escalated temsilci gelen kutusu: sayaçlı kayıtlı görünümler, her talepte SLA geri sayımları ve öncelikler" width="100%">
</picture>

## Ne yapar

<table>
  <tr>
    <td width="40%">
      <h3>Temsilcilerinin gün boyu çalışabileceği bir gelen kutusu</h3>
      Konuşma, dahili notlar, hazır yanıtlar ve SLA sayaçları tek ekranda. Talepler Postmark, Mailgun veya SES üzerinden e-postayla da gelir.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="Temsilci çalışma alanında yanıt düzenleyicisiyle açık bir talep">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="Yanıt süreleri, CSAT ve SLA ihlallerini gösteren yönetici rapor sayfası">
      </picture>
    </td>
    <td width="40%">
      <h3>Görebildiğin SLA'lar ve eskalasyon kuralları</h3>
      Mesai saatlerini dikkate alan yanıt ve çözüm hedefleri, hedef kaçtığında talebi yeniden atayıp bildirim gönderen kurallar ve ihlal raporları.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>Hazır gelen bir müşteri portalı</h3>
      Müşteriler uygulamanın içinden talep açar, yanıt verir ve durumu kontrol eder. Widget'ı tek bir script etiketiyle başka sitelere yerleştirebilirsin.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="Müşteri portalındaki talep listesi">
      </picture>
    </td>
  </tr>
</table>

## Özellikler

<table>
<tr>
<td width="33%" valign="top">

**Talepler ve gelen kutusu**
- Öncelikler, departmanlar, etiketler ve özel alanlar
- Talepleri birleştirme, bağlama ve bölme
- Otomatik uyandırmalı erteleme
- Talep içinde yan konuşmalar
- Kişisel ve paylaşılan kayıtlı görünümler
- Makrolar ve hazır yanıtlar

</td>
<td width="33%" valign="top">

**SLA'lar ve yönlendirme**
- Yanıt ve çözüm hedefleri
- Mesai saati desteği
- SLA ihlalinde eskalasyon kuralları
- Temsilci başına kapasite sınırları
- Yetenek tabanlı yönlendirme

</td>
<td width="33%" valign="top">

**Müşteriler**
- İstek sınırlamalı widget API'si
- Widget veya e-postadan herkese açık talepler
- İmzalı Reply-To ile e-posta zincirleme
- Yapılandırılabilir misafir politikası
- Token tabanlı misafir erişimi
- Çözümden sonra CSAT anketleri
- Arama ve puanlamalı bilgi bankası

</td>
</tr>
<tr>
<td width="33%" valign="top">

**Otomasyon**
- Talep ve yanıt olaylarında workflow'lar
- Zamanlanmış SLA kontrolleri ve ertelenenleri uyandırma
- Yeniden denemeli, HMAC imzalı webhook'lar
- İsteğe bağlı Socket.IO üzerinden anlık güncellemeler

</td>
<td width="33%" valign="top">

**Erişim ve güvenlik**
- Nest guard'larıyla roller ve izinler
- İki adımlı doğrulama (TOTP)
- SAML, OAuth 2 / OIDC veya JWT ile SSO
- Kapsamı sınırlı yetkilere sahip Bearer API token'ları
- Her değişikliğin denetim kaydı

</td>
<td width="33%" valign="top">

**Genişletme**
- Plugin SDK ile geliştirilen eklentiler
- Talep, etiket ve departmanları toplu içe aktarma
- @escalated-dev/locale içinden çeviriler
- Herhangi bir çeviriyi uygulamanda geçersiz kılma

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">Tüm özellikler ayrıntılı olarak</a></sub></p>

<p align="center"><b>Kullanılan teknolojiler</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## Hızlı başlangıç

```bash
npm install @escalated-dev/escalated-nestjs
```

Ardından `EscalatedModule.forRoot()` modülünü kendi `adminGuard`, `agentGuard` ve `customerGuard` değerlerinle `AppModule` içine ekle ve ekranları sunmak için `ui: { enabled: true }` ayarla (varsayılan olarak kapalıdır). Node.js 22+, NestJS 11 ve TypeORM 0.3 gerekir. [Başlangıç kılavuzu](../getting-started.md) tüm seçenekleri anlatır.

## Daha fazla bilgi

- [Tüm özellikler](../features.md) · [Başlarken](../getting-started.md) · [Ekranlar (Inertia UI)](../ui.md)
- [API referansı](../api.md) · [Olaylar ve genişletme noktaları](../extending.md) · [Workflow'lar](../workflows.md)
- [Temsilci paneli](../agent-panel.md) · [Erişim kontrolü](../access-control.md) · [Talep erişimi ve yönlendirme](../ticket-access-and-routing.md)
- [Widget'ı yerleştirme](../embedding-the-widget.md) · [Yönetim panelini yerleştirme](../embedding-admin.md) · [Misafir erişimi](../guest-access.md)
- [Eklentiler](../plugins.md) · [Bültenler](../newsletters.md) · [Geliştirme](../development.md) · [Bağımlılık denetimi](../dependency-audit.md)

Escalated ayrıca [Laravel](https://github.com/escalated-dev/escalated-laravel), [Rails](https://github.com/escalated-dev/escalated-rails), [Django](https://github.com/escalated-dev/escalated-django), [AdonisJS](https://github.com/escalated-dev/escalated-adonis), [Symfony](https://github.com/escalated-dev/escalated-symfony), [Phoenix](https://github.com/escalated-dev/escalated-phoenix), [Go](https://github.com/escalated-dev/escalated-go), [.NET](https://github.com/escalated-dev/escalated-dotnet), [Spring](https://github.com/escalated-dev/escalated-spring), [WordPress](https://github.com/escalated-dev/escalated-wordpress) ve [Filament](https://github.com/escalated-dev/escalated-filament) için de mevcut. Arayüz [escalated](https://github.com/escalated-dev/escalated) deposunda bulunur.

## Lisans

MIT. Copyright (c) 2026 Escalated.dev. Bkz. [LICENSE](../../LICENSE).
