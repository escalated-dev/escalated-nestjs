# Verified guest access

Guests prove they can read the mailbox they give before they create a widget
ticket, start a widget chat or look a ticket up: an eight-digit code is emailed
to them. They then open their ticket with an expiring grant instead of a
permanent link. This ports escalated-laravel's verified guest access
(`docs/guest-access.md` there) and follows the same contract, so the shared
widget's flows work unchanged.

## Upgrade

1. Register and run the exported `VerifiedGuestAccess1792627200000` migration.
   It adds the `escalated_guest_verifications` table and four nullable ticket
   columns (`guestVerifiedEmail`, `guestEmailVerifiedAt`, `guestAccessHash`,
   `guestAccessExpiresAt`).
2. Set a stable key: `guestAccess.secret`, or the
   `ESCALATED_GUEST_ACCESS_SECRET` environment variable (`inbound.replySecret`
   is used when neither is set). It keys the email and code digests and
   encrypts the grants, so every instance needs the same one. Without a key, a
   random one is made per process and grants end on restart.
3. Configure `mail` so codes can be sent, or send them yourself with
   `guestAccess.sendCode: async (email, code, purpose) => { ... }`.
4. Ship a shared frontend (`@escalated-dev/escalated`) whose widget has the
   email-code step. Older widgets cannot create guest tickets or start chats any
   more.

**Existing guest links.** The permanent guest tokens (`?guest_token=`,
`X-Guest-Token`, and links in emails sent before the upgrade) no longer open
anything, as in Laravel. Tickets are untouched; a guest renews access with a
lookup (below), which issues a grant and clears the old token. To keep old links
working during a transition, set `guestAccess.legacyTokens: true`, and turn it
off once guests have moved over.

## Email codes

`POST verification`, on `/escalated/widget` and `/escalated/guest`:

```json
{ "email": "recipient@example.com", "purpose": "ticket" }
```

`purpose` is `ticket`, `chat` or `lookup`. The answer is
`202 { verification_id, expires_in: 600, message }`. Only the email holds the
code.

Send `verification_id` and `verification_code` with the operation the code is
for. A code:

- is bound to the normalised email address and the purpose;
- expires after ten minutes;
- allows five guesses, and every guess counts, right or wrong;
- is spent once. If the operation it authorises fails (a bad department, for
  example), it is released so the guest can retry with the same code.

Neither the code nor the address is stored in the clear. Both are HMAC
digests under the guest access key. Codes that expired a day ago are deleted
as new ones are made.

Budgets: 3 codes per mailbox per client IP per hour, and 10 per mailbox per
hour across all IPs, so one client cannot lock the owner out. Requests over
budget get 429 with `Retry-After`. Tune these with
`guestAccess.challengesPerClientPerHour` and
`guestAccess.challengesPerMailboxPerHour`. They are counted in
`guestRateLimit.storage`, or else in the in-memory throttler store. On top of
that, `verification` and `lookup` share a per-IP limit of 10 per minute
(`guestRateLimit.verificationsPerMinute`).

## Tickets and grants

`POST /escalated/widget/tickets` takes the existing body plus the proof fields.
It answers 201 with `{ message, reference, ticket_reference,
guest_access_token, expires_at }`. A ticket filed for a host-authenticated
`req.user` (no `email`) needs no code and gets no grant.

A grant is an opaque, encrypted (AES-256-GCM), expiring token. Do not parse
it. It lasts `guestAccess.ttlMinutes` (default 1440, clamped to between 5
minutes and 7 days). The ticket stores only the SHA-256 of the grant's random
nonce. Issuing a new grant rotates the nonce, which revokes the earlier grant.
Changing the email of the ticket's contact revokes its proof and its grants.
Host code can call `GuestAccessService.revoke(ticket)`.

A grant opens these routes, on `/escalated/widget` and `/escalated/guest`:

- `GET tickets/:reference`, which answers `{ reference, subject, status,
  status_label, status_color, created_at, department, replies }`. The replies
  are the 20 latest public ones.
- `POST tickets/:reference/replies` with `{ body }`.

Send the grant as `Authorization: Bearer <grant>`. `X-Guest-Token` is also
accepted. The grant must name that ticket: an email query parameter or a
reference alone authorises nothing. It also authorises a guest websocket
(`handshake.auth.guestToken`). Guest answers carry
`Cache-Control: no-store, private` and `Referrer-Policy: no-referrer`. Redact
guest grants and `Authorization` headers from access logs.

## Lookup and renewal

Request a `lookup` code, then `POST lookup` on either prefix:

```json
{ "email": "...", "reference": "ESC-00042", "verification_id": "...", "verification_code": "..." }
```

The answer is `{ data: [{ reference, subject, guest_access_token, expires_at }] }`.
It lists the tickets with that reference whose contact has that email, at most
20. A reference alone unlocks nothing. The list may be empty, and the code is
spent either way.

## Live chat

`POST /escalated/widget/chat/start` needs a `chat` code for the visitor's
email, and is limited to 5 starts per IP per minute
(`guestRateLimit.chatsPerMinute`). The chat routes still use the chat's
random visitor token (`id`). Chat tokens do not expire in this package.

## Mobile guest API

The mobile face of verified guest access, under the REST API prefix plus
`/mobile`. It follows the canonical contract,
[mobile-guest-api](https://github.com/escalated-dev/escalated-developer-context/blob/main/domain-model/mobile-guest-api.md):

| Method | Path | Guest budget |
|---|---|---|
| POST | `/escalated/api/v1/mobile/guest/verification` | `verificationsPerMinute` |
| POST | `/escalated/api/v1/mobile/guest/lookup` | `verificationsPerMinute` |
| POST | `/escalated/api/v1/mobile/guest/tickets` | `ticketsPerMinute` (+ 10 per email per hour) |
| GET | `/escalated/api/v1/mobile/guest/tickets/:token` | none |
| POST | `/escalated/api/v1/mobile/guest/tickets/:token/replies` | `repliesPerMinute` |

`verification` and `lookup` run the same handlers as on `/escalated/widget`
and `/escalated/guest`. The routes use the same codes, grants and per-IP guest
budgets as those prefixes (one budget per IP across all three), so a grant
from the mobile create opens the widget and guest routes, and a grant from a
widget create or a lookup opens the mobile ones.

- `POST guest/tickets` takes JSON `{ name, email, subject, description,
  verification_id, verification_code, priority?, department_id? }`. Fields are
  checked first (422), then the `ticket` code (422 on `verification_code`,
  nothing created), then the ticket is filed with channel `web` under the guest
  policy. It answers `201 { data: <mobile ticket>, message: "Ticket created." }`
  with `data.guest_access_token` and `data.guest_access_expires_at` set.
  Other fields (`metadata`, `external_reference`, status, assignee) are
  ignored.
- `GET guest/tickets/:token` answers `{ data: <mobile ticket> }` with the
  public replies, newest first.
- `POST guest/tickets/:token/replies` takes `{ email, body }`. A closed ticket
  is 422 `This ticket is closed.`; the email (any case) must be the ticket's
  guest email, else 403. It answers `201 { message: "Reply sent." }`.

`:token` is the grant itself. An expired, rotated, revoked, malformed or
over-long grant, or a chat visitor token, is a 404. The mobile ticket object is
allow-listed: staff appear only as `{ id: 0, name, email: "" }` (the agent
profile's display name, or `Support`), `metadata` is always `{}`, and internal
notes, contact ids and grant hashes never appear. Every answer, errors and
429s included, carries `Cache-Control: private, no-store` and
`Referrer-Policy: no-referrer`. Redact the `:token` path segment from access
logs.

These routes are registered with the package's other REST API routes
(`/escalated/api/v1/auth/*`). This package has no REST-API-enabled switch, so
they are always mounted, like the widget routes.

## Not in this package

- Mobile guest attachments. The mobile routes take JSON only (no
  `multipart/form-data` uploads), and reply attachments are listed with
  `url: null` because there is no guest-authorised download route yet.
- The contract's API-layer limiter (`X-RateLimit-*`, 60 per minute) and the
  shared 60-per-minute guest `requests` bucket: this package has neither. The
  mobile routes use the existing guest buckets above.
- A guest-tickets or chat on/off switch: guest tickets and chats are always
  on here, so the contract's 403 for a disabled feature never applies.
- Lookup matches the Escalated reference only, not a host
  `external_reference`.
- Spending a code and the operation are not one database transaction. The code
  is claimed with a conditional update first, and released if the operation
  fails.
- Ticket creation stays on the widget prefix; `/escalated/guest` has no create
  route.
- Customer email links still carry the permanent token, so they only work with
  `legacyTokens`.
