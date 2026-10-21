# Workflows

Workflows are admin-defined, event-driven rules: when an event fires on a
ticket and the conditions match, the actions run. (Time-based rules are
Automations; agent one-click bundles are Macros.)

The admin API is JSON and follows the shared wire contract,
escalated-developer-context `domain-model/workflow-admin-contract.md`, so the
shared builder's request bodies work unchanged. Every route is under
`/escalated/admin/workflows` and protected by `adminGuard`. Changes are written
to the audit log.

## Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/escalated/admin/workflows` | | `{ workflows: [workflow, ...] }` in `position` order |
| GET | `/escalated/admin/workflows/options` | | `{ trigger_events, action_types, operators }` for the builder form |
| GET | `/escalated/admin/workflows/:id` | | `workflow` |
| POST | `/escalated/admin/workflows` | [payload](#payload) | `201` `workflow` |
| PUT | `/escalated/admin/workflows/:id` | [payload](#payload) | `200` `workflow` |
| DELETE | `/escalated/admin/workflows/:id` | | `204`; its logs are deleted too |
| POST | `/escalated/admin/workflows/:id/toggle` | | `200` `workflow`, `is_active` flipped |
| POST | `/escalated/admin/workflows/reorder` | `{ "workflow_ids": [3, 1, 2] }` | `200` `{ workflows }` in the new order |
| GET | `/escalated/admin/workflows/logs` | `?workflow_id=` optional | `{ logs: [log, ...] }`, newest 100 |
| GET | `/escalated/admin/workflows/:id/logs` | | `{ logs: [log, ...] }`, newest 100 |

## Payload

```json
{
  "name": "Route refunds to billing",
  "description": null,
  "trigger_event": "ticket.created",
  "conditions": { "all": [{ "field": "subject", "operator": "contains", "value": "refund" }] },
  "actions": [
    { "type": "change_priority", "value": "high" },
    { "type": "set_department", "value": "4" }
  ],
  "is_active": true
}
```

- `name`, `trigger_event` and at least one action are required.
- `trigger_event` must be one of the `trigger_events` options. A legacy name
  (`ticket.replied`, `ticket.tagged`, ...) is accepted and stored as its
  canonical name (ADR 2026-10-21).
- `conditions` holds exactly one of `all` or `any`. Leaving it out means
  `{ "all": [] }`, which matches every ticket.
- Each action's `type` must be one of the `action_types` options. `value` is a
  scalar and is stored as a string.
- `is_active` defaults to `true`. A new workflow goes last in `position`.

A body that breaks these rules gets `422`:

```json
{ "message": "The given data was invalid.", "errors": { "actions": ["Add at least one action."] } }
```

## The workflow object

`id`, `name`, `description`, `trigger_event` (canonical, also as the
read-only `trigger`), `conditions`, `actions`, `is_active`, `position`,
`stop_on_match`, `trigger_count` (runs whose conditions matched),
`last_triggered_at`, `created_at`, `updated_at`.

## The log object

`id`, `workflow_id`, `workflow_name`, `ticket_id`, `ticket_reference`,
`trigger_event`/`event`, `matched`, `actions_executed`, `action_details`,
`duration_ms`, `status` (`success` or `failed`), `error_message`,
`created_at`.

## Triggers

The shared event vocabulary: `ticket.created`, `ticket.updated`,
`ticket.status_changed`, `ticket.resolved`, `ticket.closed`, `ticket.reopened`,
`ticket.assigned`, `ticket.unassigned`, `ticket.escalated`,
`ticket.priority_changed`, `ticket.department_changed`, `ticket.tag_added`,
`ticket.tag_removed`, `reply.created` (public replies), `note.created`
(internal notes), `sla.warning`, `sla.breached`, `chat.started`,
`chat.assigned`, `chat.transferred`, `chat.message`, `chat.ended`.

## Conditions

Fields: `status` (status slug), `priority`, `ticket_type`, `channel`,
`subject`, `description`, `tags` (tag names), `department_id`, `assigned_to`
(host user id), `hours_since_created`, `hours_since_updated`, and `account`.
Conditions read the ticket as stored after the change that fired the trigger.

Operators: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`,
`ends_with`, `greater_than`, `less_than`, `greater_or_equal`, `less_or_equal`,
`is_empty`, `is_not_empty`. On `tags`, `contains`/`equals` mean the ticket has
that tag (case-insensitive), and `not_contains`/`not_equals` mean it does not.

Conditions stored as a flat list are read as `all`.

## Actions

`change_status` (status slug), `change_priority`, `add_tag` and `remove_tag`
(tag name; a slug or id also works), `set_department` (department id),
`assign_agent` (host user id), `add_note` (body; `{{field}}` placeholders),
`insert_canned_reply` (body), `add_follower` (host user id).
