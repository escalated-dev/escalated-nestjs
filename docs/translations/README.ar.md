<p align="center"><sub>
  <b>العربية</b> ·
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
  <a href="README.zh-CN.md">简体中文</a>
</sub></p>

<p align="center">
  <a href="https://escalated.dev"><img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/logo.png" width="72" height="72" alt="Escalated"></a>
</p>

<h1 align="center">Escalated for NestJS</h1>

<p align="center">
  أضف مكتب دعم متكاملًا إلى تطبيق NestJS الخاص بك.<br>
  التذاكر واتفاقيات مستوى الخدمة (SLA) وقواعد التصعيد وصندوق وارد للوكلاء وبوابة للعملاء، تعمل كلها على قاعدة بياناتك.
</p>

<p align="center">
  <a href="https://escalated.dev"><b>الموقع</b></a> ·
  <a href="https://escalated.dev/docs"><b>التوثيق</b></a> ·
  <a href="https://escalated.dev/cloud"><b>Cloud</b></a> ·
  <a href="../../CHANGELOG.md"><b>سجل التغييرات</b></a>
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-dark.png">
  <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/inbox-light.png" alt="صندوق وارد الوكلاء في Escalated: طرق عرض محفوظة مع أعداد، وعدّادات SLA التنازلية والأولويات على كل تذكرة" width="100%">
</picture>

## ماذا يفعل

<table>
  <tr>
    <td width="40%">
      <h3>صندوق وارد يستطيع وكلاؤك العمل فيه طوال اليوم</h3>
      المحادثة والملاحظات الداخلية والردود الجاهزة ومؤقتات SLA في شاشة واحدة. وتصل التذاكر أيضًا عبر البريد الإلكتروني من خلال Postmark أو Mailgun أو SES.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/ticket-light.png" alt="تذكرة مفتوحة في مساحة عمل الوكيل مع محرر الرد">
      </picture>
    </td>
  </tr>
  <tr>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/dashboard-light.png" alt="صفحة التقارير في لوحة الإدارة مع أوقات الاستجابة وCSAT وخروقات SLA">
      </picture>
    </td>
    <td width="40%">
      <h3>اتفاقيات SLA وقواعد تصعيد تراها أمامك</h3>
      أهداف للاستجابة والحل تراعي ساعات العمل، وقواعد تعيد الإسناد وترسل التنبيهات عند التأخر، وتقارير عن الخروقات.
    </td>
  </tr>
  <tr>
    <td width="40%">
      <h3>بوابة عملاء جاهزة بالفعل</h3>
      يفتح العملاء التذاكر ويردّون ويتابعون حالتها من تطبيقك. يمكنك تضمين الأداة في مواقع أخرى بوسم script واحد.
    </td>
    <td width="60%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-dark.png">
        <img src="https://raw.githubusercontent.com/escalated-dev/escalated/main/docs/assets/readme/portal-light.png" alt="قائمة التذاكر في بوابة العملاء">
      </picture>
    </td>
  </tr>
</table>

## الميزات

<table>
<tr>
<td width="33%" valign="top">

**التذاكر وصندوق الوارد**
- الأولويات والأقسام والوسوم والحقول المخصصة
- دمج التذاكر وربطها وتقسيمها
- التأجيل مع إعادة التنشيط التلقائي
- محادثات جانبية داخل التذكرة
- طرق عرض محفوظة شخصية ومشتركة
- وحدات الماكرو والردود الجاهزة

</td>
<td width="33%" valign="top">

**SLA والتوجيه**
- أهداف الاستجابة والحل
- دعم ساعات العمل
- قواعد التصعيد عند خرق SLA
- حدود السعة لكل وكيل
- توجيه حسب المهارات

</td>
<td width="33%" valign="top">

**العملاء**
- واجهة API للأداة مع تحديد معدل الطلبات
- تذاكر عامة من الأداة أو البريد الإلكتروني
- تسلسل رسائل البريد عبر Reply-To موقّع
- سياسة ضيوف قابلة للضبط
- وصول الضيوف عبر رموز مميزة
- استبيانات CSAT بعد الحل
- قاعدة معرفة مع البحث والتقييمات

</td>
</tr>
<tr>
<td width="33%" valign="top">

**الأتمتة**
- Workflows على أحداث التذاكر والردود
- فحوصات SLA مجدولة وإعادة تنشيط التذاكر المؤجلة
- Webhooks موقّعة بـ HMAC مع إعادة المحاولة
- تحديثات فورية اختيارية عبر Socket.IO

</td>
<td width="33%" valign="top">

**الوصول والأمان**
- الأدوار والصلاحيات عبر حراس Nest
- المصادقة الثنائية (TOTP)
- تسجيل الدخول الموحد SSO عبر SAML أو OAuth 2 / OIDC أو JWT
- رموز API من نوع Bearer بصلاحيات محددة
- سجل تدقيق لكل تغيير

</td>
<td width="33%" valign="top">

**التوسيع**
- إضافات مبنية باستخدام SDK الإضافات
- استيراد جماعي للتذاكر والوسوم والأقسام
- ترجمات من @escalated-dev/locale
- تجاوز أي ترجمة من تطبيقك

</td>
</tr>
</table>

<p align="center"><sub><a href="../features.md">كل الميزات بالتفصيل</a></sub></p>

<p align="center"><b>مبني باستخدام</b></p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://typeorm.io"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM"></a>
  <a href="https://vuejs.org"><img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&logo=vuedotjs&logoColor=white" alt="Vue.js"></a>
  <a href="https://inertiajs.com"><img src="https://img.shields.io/badge/Inertia-9553E9?style=for-the-badge&logo=inertia&logoColor=white" alt="Inertia"></a>
</p>

## البدء السريع

```bash
npm install @escalated-dev/escalated-nestjs
```

بعد ذلك أضف `EscalatedModule.forRoot()` إلى `AppModule` مع `adminGuard` و`agentGuard` و`customerGuard` الخاصة بك، واضبط `ui: { enabled: true }` لتقديم الشاشات (فهي معطّلة افتراضيًا). يتطلب Node.js 22+ وNestJS 11 وTypeORM 0.3. يشرح [دليل البدء](../getting-started.md) كل خيار.

## اعرف المزيد

- [كل الميزات](../features.md) · [البدء](../getting-started.md) · [الشاشات (Inertia UI)](../ui.md)
- [مرجع API](../api.md) · [الأحداث ونقاط التوسيع](../extending.md) · [Workflows](../workflows.md)
- [لوحة الوكيل](../agent-panel.md) · [التحكم في الوصول](../access-control.md) · [الوصول إلى التذاكر والتوجيه](../ticket-access-and-routing.md)
- [تضمين الأداة](../embedding-the-widget.md) · [تضمين لوحة الإدارة](../embedding-admin.md) · [وصول الضيوف](../guest-access.md)
- [الإضافات](../plugins.md) · [النشرات البريدية](../newsletters.md) · [التطوير](../development.md) · [تدقيق التبعيات](../dependency-audit.md)

يتوفر Escalated أيضًا لـ [Laravel](https://github.com/escalated-dev/escalated-laravel) و[Rails](https://github.com/escalated-dev/escalated-rails) و[Django](https://github.com/escalated-dev/escalated-django) و[AdonisJS](https://github.com/escalated-dev/escalated-adonis) و[Symfony](https://github.com/escalated-dev/escalated-symfony) و[Phoenix](https://github.com/escalated-dev/escalated-phoenix) و[Go](https://github.com/escalated-dev/escalated-go) و[.NET](https://github.com/escalated-dev/escalated-dotnet) و[Spring](https://github.com/escalated-dev/escalated-spring) و[WordPress](https://github.com/escalated-dev/escalated-wordpress) و[Filament](https://github.com/escalated-dev/escalated-filament). توجد الواجهة في [escalated](https://github.com/escalated-dev/escalated).

## الترخيص

MIT. حقوق النشر (c) 2026 Escalated.dev. راجع [LICENSE](../../LICENSE).
