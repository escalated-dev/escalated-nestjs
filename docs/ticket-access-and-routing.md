# Ticket access and routing

Visibility defaults to `all`; accounts, account visibility and targeted SLAs are
opt-in. Existing installations keep their behavior. Register the exported
`TicketAccessAndRouting1791918000000` migration with the host DataSource and run
it before enabling the options. It preserves existing rows, adds nullable
account/type/target columns and indexes, and follows the DataSource table prefix.
New installations may generate their normal TypeORM migration from the entities.

```ts
EscalatedModule.forRoot({
  visibility: 'department',
  ticketAccess: {
    resolveUser: async (id) => {
      const user = await hostUsers.findById(id);
      return { id: user.id, isAgent: user.isSupportAgent, isAdmin: user.isSupportAdmin };
    },
  },
  accounts: {
    enabled: true,
    scopeAgents: true,
    resolver: async (reference) => {
      const account = await hostAccounts.forSupportReference(reference);
      return account ? { type: 'Company', id: String(account.id) } : null;
    },
  },
  targetedSlas: true,
});
```

The host owns user authentication and roles. `ticketAccess.resolveUser` is
required for restricted visibility, receives a host user ID, and must return
explicit `isAgent` and `isAdmin` booleans for that user. HTTP requests obtain the
ID after authentication from `apiUserId`, `userResolver(request)` or `request.user`.
Administrators bypass restrictions; existing customer/guest ownership guards
still apply. A staff route without an authenticated identity fails closed.

Department membership comes from the package's agent profile/department link,
without joining host users. Agents see only their departments; unassigned
and unrelated tickets remain hidden even when assigned to that agent. Account
visibility grants one account per agent. A null account grants no tickets.
Both restrictions intersect when enabled.

The query scope covers TypeORM repositories, query builders, pagination, search,
aggregates, bulk updates/deletes and related ticket records on the configured
DataSource. An asynchronous request context also checks tickets already loaded
by the guest-token guard. Raw SQL and external persistence integrations must
apply access checks explicitly. ORM query caching is disabled for restricted
actors so shared cache keys cannot return another user's result.

For host services and policies, inject the exported `TicketAccess` service:

```ts
const actor = await access.resolveUser(userId);
await access.withActor(actor, () => ticketService.findAll({}));
const allowed = await access.allows(actor, alreadyLoadedTicket);
```

Background work with no actor retains full access. Trusted internal code can use
`access.withActor(null, work)` to bypass visibility while retaining other query
conditions. Separate DataSources keep independent access contexts.

The account resolver receives `{ kind, type, id }`: requester and agent references
use type `User`; subject references use their configured subject type. It returns
a complete stable type/id pair or null and may be asynchronous. No company table
is supplied. `TicketService.create` resolves the requester account. Subject
attachment fills only an empty account and cannot overwrite it through a stale
ticket instance. Trusted creation calls can pass a third argument with `subjects`
and/or `account`; subjects are attached before creation events run. Splitting a
ticket preserves its account and type. HTTP DTOs do not accept arbitrary account
assignments. Lists accept `accountType` and `accountId` together as an exact-case
filter, plus `ticketType`.

Escalation conditions support `ticket_type`, `department_id`, `account_type`,
`account_id` and `account: { type, id }`. Workflows and automations accept those
fields in their normal field/operator/value format. Compound workflow accounts
support equals, not_equals, is_empty and is_not_empty. Malformed identities fail
closed. Both account components are compared case-sensitively on supported DBs.

SLA policies accept nullable `departmentId` and `ticketType`. Targeted selection
ranks both targets, department, type, then untargeted default; lowest ID wins a
tie. Only active policies qualify. Targeting off retains the existing condition
matching and untargeted default behavior. Targeted policies are selected on
creation. Department/type changes preserve the current policy and clock; call
`SlaService.applyToTicket(ticket)` explicitly to reselect. Targeted deadlines
are calculated from ticket creation.

Business-hours deadlines follow escalated-laravel. A policy counts business
hours when it has its own `businessScheduleId` or `businessHoursOnly` is set;
the schedule is the policy's, else the ticket department's
`businessScheduleId`, else the default schedule (`isDefault`), and calendar
time when none applies. Hours are wall-clock times in the schedule's
`timezone`, counted in real elapsed time across daylight-saving changes;
holidays (one-off or `isRecurring`) close the window that opens on their local
date; an end before the start is an overnight window and `24:00` is midnight.
Run the exported `BusinessSchedulePrecedence1792800000000` migration to add
`businessHoursOnly` and the department column.

Follower notification recipient IDs and chat assignment candidates are checked
against access. Hosts sending their own notifications should call `allowsUser`
at delivery time. Guest-contact email remains governed by the guest ownership
flow. WebSocket connections use the host-authenticated identity (`websocketAuth`,
`userResolver` or the handshake request's `user`); guest clients supply
`handshake.auth.guestToken` or `handshake.auth.chatToken`. Unidentified
sockets are refused in every visibility mode. Subscriptions and each delivery check
the current ticket membership/account, including broad creation and queue events.
Raw broadcast streams must not be exposed separately to restricted clients.
