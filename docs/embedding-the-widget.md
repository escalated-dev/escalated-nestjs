# Embedding the widget on other sites

The support widget, ticket form and live chat can run on a site other than
the one your NestJS app serves: a store, a marketing site or a customer portal
loads one script from your app. Nothing changes until you list the sites that
may do this.

## 1. Allow the embedding sites

In the module options:

```ts
EscalatedModule.forRoot({
  widgetOrigins: ['https://shop.example.com', 'https://*.example.org'],
});
```

in the environment:

```dotenv
ESCALATED_WIDGET_ALLOWED_ORIGINS=https://shop.example.com,https://*.example.org
```

or in the `widget_allowed_origins` setting (one per line or comma separated),
saved through `PUT /escalated/admin/settings`:

```json
[{ "key": "widget_allowed_origins", "value": "https://shop.example.com\nhttps://*.example.org" }]
```

All three lists are combined. Each entry is an origin: `scheme://host[:port]`,
http or https, no path, query or user name. `https://*.example.org` matches
every subdomain of `example.org` at any depth, but not `example.org` itself and
not `http://`. A bare `*` is never accepted. The admin endpoint rejects the
whole update with a 400 when any entry is invalid; invalid entries in the
module option or the environment are ignored.

The option defaulted to `['*']` before, but it was never applied, so no site
had access. It now defaults to `[]`.

## 2. Add the script to the other site

```html
<script src="https://help.example.com/escalated/widget/embed.js" async></script>
```

For an on-page support form instead of a floating button:

```html
<div id="support-form"></div>
<script
  src="https://help.example.com/escalated/widget/embed.js"
  data-mode="inline"
  data-target="#support-form"
  data-tabs="ticket"
  data-department="3"
  data-lock-department="true"
  data-meta-order-number="A-1001"
></script>
```

All host parameters (tabs, department, prefill, metadata, title, the
JavaScript API) are described in the frontend package's
[embedding guide](https://github.com/escalated-dev/escalated/blob/main/docs/embedding-the-widget.md).

## What the server does

`WidgetCorsMiddleware` runs on every `/escalated/widget/*` route, including
the live chat routes under `/escalated/widget/chat/*`. For a request whose
`Origin` names another site on the list it:

- answers preflight requests (`OPTIONS` with `Access-Control-Request-Method`)
  with 204, `Access-Control-Allow-Origin: <origin>`, methods
  `GET, POST, OPTIONS`, headers
  `Accept, Authorization, Content-Type, X-Requested-With` and a 600 second
  `Access-Control-Max-Age`;
- adds `Access-Control-Allow-Origin`, `Access-Control-Expose-Headers:
  Retry-After` and `Vary: Origin` to every other response, including 400,
  403, 404 and 429 answers from guards and exception filters;
- treats the visitor as a guest even if the same browser is signed in to your
  app: `req.user` is removed, ticket access resolves no user, and a ticket
  without an email is refused instead of being filed as the signed-in user.
  Guest tokens (`X-Guest-Token` or `?guest_token=`) work as before.

`Access-Control-Allow-Credentials` is never sent, so browsers send no cookies
with these requests.

Preflights from other origins get a 204 without a grant. Every other request
from an origin that is not listed, same-origin requests and requests without
an `Origin` header are handled exactly as before. The widget routes take JSON
and use no CSRF token, so there is no CSRF check to skip. Guest rate limits
and the guest policy apply to embedded requests unchanged.

The middleware compares the `Origin` header with the request's own protocol
and `Host`. Behind a proxy, configure the HTTP adapter's `trust proxy` so
`req.protocol` is right. Do not list your app's own origin: it does not need
CORS, and listing it would make its own pages' widget requests run as guests if
the protocol were misread.

### `GET /escalated/widget/config`

Returns what the widget needs before it renders:

```json
{
  "enabled": true,
  "color": "#4F46E5",
  "position": "bottom-right",
  "greeting": "Hi there! How can we help?",
  "departments": [{ "id": 1, "name": "Sales" }],
  "kb_enabled": true,
  "guest_tickets_enabled": true,
  "accepts_metadata": true
}
```

The widget routes are always mounted, so `enabled` is always true. `color`,
`position` and `greeting` come from the `widget_color`, `widget_position` and
`widget_greeting` settings. `departments` lists active departments.
`kb_enabled` follows the `enableKnowledgeBase` option.

### Host parameters

`POST /escalated/widget/tickets` and `POST /escalated/widget/chat/start` accept
an optional `metadata` object. It is stored in the ticket's `metadata` column
(for a chat, on the chat's ticket). The values come from the visitor's
browser, so only a flat map is kept: up to 25 entries, keys of letters,
digits, `_ . : -` (64 characters at most), and string, number or boolean
values (strings trimmed and cut to 500 characters). `page_url` is kept only
when it is an http(s) URL of at most 2048 characters. `embedded_on` is always
set by the server from the request's `Origin` and cannot be supplied by the
page. A `metadata` that is not an object, or has more than 50 keys, is
rejected with 400. Treat all of it as unverified visitor input.

Existing installations add the column with the exported migration:

```ts
import { WidgetTicketMetadata1792281600000 } from '@escalated-dev/escalated-nestjs';

new DataSource({
  // ...
  migrations: [WidgetTicketMetadata1792281600000],
});
```

It adds a nullable text column, keeps existing rows and follows the
DataSource table prefix. New installations may generate their normal TypeORM
migration from the entities.

### The script

`GET /escalated/widget/embed.js` serves `assets/widget/escalated-widget.js`,
the standalone bundle from `@escalated-dev/escalated` 0.12.1, with
`Cache-Control: public, max-age=3600`, an `ETag` (answering
`If-None-Match` with 304), `X-Content-Type-Options: nosniff`,
`Cross-Origin-Resource-Policy: cross-origin` and
`Access-Control-Allow-Origin: *`. If you serve the bundle from a CDN instead,
pages need `data-base-url` pointing at your app.

To update the bundle, copy `dist/widget/escalated-widget.js` from the
published npm package (`npm pack @escalated-dev/escalated@<version>`) over the
vendored file.

## Troubleshooting

- **The browser reports a CORS error.** The page's origin is not on the list,
  or it differs in scheme or port (`http://` vs `https://`, `:8080`).
- **A host CORS setup answers first.** If the app calls `app.enableCors()` or
  registers its own CORS middleware for every route, that runs before the
  module's middleware and answers widget preflights with its own settings.
  Leave `/escalated/widget` out of it.
- **A signed-in agent testing the embed sees guest behaviour.** That is
  intended: requests from another site never act as the signed-in user.
