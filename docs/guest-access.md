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
(`guestRateLimit.chatsPerMinute`). The chat routes use the chat's random
visitor token (`id`); only its SHA-256 is stored. The token expires
`guestAccess.ttlMinutes` after the chat starts (`expires_at` in the start
response). After that, and for any unknown token, every
`widget/chat/:token/*` route answers 404 and the visitor starts a new chat.
An ended chat refuses messages, typing and a second end with 422, but its
transcript and rating stay available until the token expires. Chats started
before tokens expired get a full lifetime from their next request.

## Not in this package

- Mobile guest routes: this package has none.
- Lookup matches the Escalated reference only, not a host
  `external_reference`.
- Spending a code and the operation are not one database transaction. The code
  is claimed with a conditional update first, and released if the operation
  fails.
- Ticket creation stays on the widget prefix; `/escalated/guest` has no create
  route.
- Customer email links still carry the permanent token, so they only work with
  `legacyTokens`.
