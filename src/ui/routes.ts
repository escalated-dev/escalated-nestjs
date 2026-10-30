/**
 * The named routes the shared components call through `route(name, params)`
 * (Laravel's Ziggy helper), with the URIs this package serves them at.
 *
 * Shared as the `ziggy` prop in the shape ziggy-js reads, so a host may use
 * ziggy-js; the default root view installs a small compatible `route()`.
 * A name the components call that is missing here has no screen behind it yet.
 */
export interface NamedRoute {
  uri: string;
  methods: string[];
}

const GET = ['GET', 'HEAD'];
const POST = ['POST'];
const PUT = ['PUT'];
const PATCH = ['PATCH'];
const DELETE = ['DELETE'];

export const ESCALATED_UI_PREFIX = 'escalated';

const routes: Record<string, NamedRoute> = {
  // Agent
  'escalated.agent.dashboard': { uri: 'escalated/agent', methods: GET },
  'escalated.agent.tickets.index': { uri: 'escalated/agent/tickets', methods: GET },
  'escalated.agent.tickets.show': { uri: 'escalated/agent/tickets/{ticket}', methods: GET },
  'escalated.agent.tickets.update': { uri: 'escalated/agent/tickets/{ticket}', methods: PUT },
  'escalated.agent.tickets.reply': { uri: 'escalated/agent/tickets/{ticket}/reply', methods: POST },
  'escalated.agent.tickets.note': { uri: 'escalated/agent/tickets/{ticket}/note', methods: POST },
  'escalated.agent.tickets.assign': {
    uri: 'escalated/agent/tickets/{ticket}/assign',
    methods: POST,
  },
  'escalated.agent.tickets.status': {
    uri: 'escalated/agent/tickets/{ticket}/status',
    methods: POST,
  },
  'escalated.agent.tickets.priority': {
    uri: 'escalated/agent/tickets/{ticket}/priority',
    methods: POST,
  },
  'escalated.agent.tickets.tags': { uri: 'escalated/agent/tickets/{ticket}/tags', methods: POST },
  'escalated.agent.tickets.department': {
    uri: 'escalated/agent/tickets/{ticket}/department',
    methods: POST,
  },
  'escalated.agent.tickets.macro': { uri: 'escalated/agent/tickets/{ticket}/macro', methods: POST },
  'escalated.agent.tickets.follow': {
    uri: 'escalated/agent/tickets/{ticket}/follow',
    methods: POST,
  },
  // Admin
  'escalated.admin.tickets.index': { uri: 'escalated/admin/tickets', methods: GET },
  'escalated.admin.tickets.bulk': { uri: 'escalated/admin/tickets/bulk', methods: POST },
  'escalated.admin.tickets.show': { uri: 'escalated/admin/tickets/{ticket}', methods: GET },
  'escalated.admin.tickets.reply': {
    uri: 'escalated/admin/tickets/{ticket}/reply',
    methods: POST,
  },
  'escalated.admin.tickets.note': {
    uri: 'escalated/admin/tickets/{ticket}/note',
    methods: POST,
  },
  'escalated.admin.tickets.assign': {
    uri: 'escalated/admin/tickets/{ticket}/assign',
    methods: POST,
  },
  'escalated.admin.tickets.status': {
    uri: 'escalated/admin/tickets/{ticket}/status',
    methods: POST,
  },
  'escalated.admin.tickets.priority': {
    uri: 'escalated/admin/tickets/{ticket}/priority',
    methods: POST,
  },
  'escalated.admin.tickets.tags': {
    uri: 'escalated/admin/tickets/{ticket}/tags',
    methods: POST,
  },
  'escalated.admin.tickets.department': {
    uri: 'escalated/admin/tickets/{ticket}/department',
    methods: POST,
  },
  'escalated.admin.tickets.macro': {
    uri: 'escalated/admin/tickets/{ticket}/macro',
    methods: POST,
  },
  'escalated.admin.tickets.follow': {
    uri: 'escalated/admin/tickets/{ticket}/follow',
    methods: POST,
  },
  'escalated.admin.tickets.snooze': {
    uri: 'escalated/admin/tickets/{ticket}/snooze',
    methods: POST,
  },
  'escalated.admin.tickets.unsnooze': {
    uri: 'escalated/admin/tickets/{ticket}/unsnooze',
    methods: POST,
  },
  'escalated.admin.saved-views.store': { uri: 'escalated/admin/saved-views', methods: POST },
  'escalated.admin.saved-views.update': {
    uri: 'escalated/admin/saved-views/{savedView}',
    methods: PUT,
  },
  'escalated.admin.saved-views.destroy': {
    uri: 'escalated/admin/saved-views/{savedView}',
    methods: DELETE,
  },
  'escalated.admin.sla-policies.index': { uri: 'escalated/admin/sla-policies', methods: GET },
  'escalated.admin.sla-policies.create': {
    uri: 'escalated/admin/sla-policies/create',
    methods: GET,
  },
  'escalated.admin.sla-policies.store': { uri: 'escalated/admin/sla-policies', methods: POST },
  'escalated.admin.sla-policies.edit': {
    uri: 'escalated/admin/sla-policies/{sla_policy}/edit',
    methods: GET,
  },
  'escalated.admin.sla-policies.update': {
    uri: 'escalated/admin/sla-policies/{sla_policy}',
    methods: PUT,
  },
  'escalated.admin.sla-policies.destroy': {
    uri: 'escalated/admin/sla-policies/{sla_policy}',
    methods: DELETE,
  },
  'escalated.admin.statuses.index': { uri: 'escalated/admin/statuses', methods: GET },
  'escalated.admin.statuses.create': { uri: 'escalated/admin/statuses/create', methods: GET },
  'escalated.admin.statuses.store': { uri: 'escalated/admin/statuses', methods: POST },
  'escalated.admin.statuses.edit': { uri: 'escalated/admin/statuses/{status}/edit', methods: GET },
  'escalated.admin.statuses.update': { uri: 'escalated/admin/statuses/{status}', methods: PUT },
  'escalated.admin.statuses.destroy': { uri: 'escalated/admin/statuses/{status}', methods: DELETE },
  'escalated.admin.escalation-rules.index': {
    uri: 'escalated/admin/escalation-rules',
    methods: GET,
  },
  'escalated.admin.escalation-rules.create': {
    uri: 'escalated/admin/escalation-rules/create',
    methods: GET,
  },
  'escalated.admin.escalation-rules.store': {
    uri: 'escalated/admin/escalation-rules',
    methods: POST,
  },
  'escalated.admin.escalation-rules.edit': {
    uri: 'escalated/admin/escalation-rules/{escalation_rule}/edit',
    methods: GET,
  },
  'escalated.admin.escalation-rules.update': {
    uri: 'escalated/admin/escalation-rules/{escalation_rule}',
    methods: PUT,
  },
  'escalated.admin.escalation-rules.destroy': {
    uri: 'escalated/admin/escalation-rules/{escalation_rule}',
    methods: DELETE,
  },
  'escalated.admin.macros.index': { uri: 'escalated/admin/macros', methods: GET },
  'escalated.admin.macros.store': { uri: 'escalated/admin/macros', methods: POST },
  'escalated.admin.macros.update': { uri: 'escalated/admin/macros/{macro}', methods: PUT },
  'escalated.admin.macros.destroy': { uri: 'escalated/admin/macros/{macro}', methods: DELETE },
  'escalated.admin.canned-responses.index': {
    uri: 'escalated/admin/canned-responses',
    methods: GET,
  },
  'escalated.admin.canned-responses.store': {
    uri: 'escalated/admin/canned-responses',
    methods: POST,
  },
  'escalated.admin.canned-responses.update': {
    uri: 'escalated/admin/canned-responses/{cannedResponse}',
    methods: PUT,
  },
  'escalated.admin.canned-responses.destroy': {
    uri: 'escalated/admin/canned-responses/{cannedResponse}',
    methods: DELETE,
  },
  'escalated.admin.webhooks.index': { uri: 'escalated/admin/webhooks', methods: GET },
  'escalated.admin.webhooks.create': { uri: 'escalated/admin/webhooks/create', methods: GET },
  'escalated.admin.webhooks.store': { uri: 'escalated/admin/webhooks', methods: POST },
  'escalated.admin.webhooks.edit': { uri: 'escalated/admin/webhooks/{webhook}/edit', methods: GET },
  'escalated.admin.webhooks.update': { uri: 'escalated/admin/webhooks/{webhook}', methods: PUT },
  'escalated.admin.webhooks.destroy': {
    uri: 'escalated/admin/webhooks/{webhook}',
    methods: DELETE,
  },
  'escalated.admin.webhooks.deliveries': {
    uri: 'escalated/admin/webhooks/{webhook}/deliveries',
    methods: GET,
  },
  'escalated.admin.webhooks.retry': {
    uri: 'escalated/admin/webhooks/deliveries/{delivery}/retry',
    methods: POST,
  },
  'escalated.admin.custom-fields.index': { uri: 'escalated/admin/custom-fields', methods: GET },
  'escalated.admin.custom-fields.create': {
    uri: 'escalated/admin/custom-fields/create',
    methods: GET,
  },
  'escalated.admin.custom-fields.store': { uri: 'escalated/admin/custom-fields', methods: POST },
  'escalated.admin.custom-fields.reorder': {
    uri: 'escalated/admin/custom-fields/reorder',
    methods: POST,
  },
  'escalated.admin.custom-fields.edit': {
    uri: 'escalated/admin/custom-fields/{custom_field}/edit',
    methods: GET,
  },
  'escalated.admin.custom-fields.update': {
    uri: 'escalated/admin/custom-fields/{custom_field}',
    methods: PUT,
  },
  'escalated.admin.custom-fields.destroy': {
    uri: 'escalated/admin/custom-fields/{custom_field}',
    methods: DELETE,
  },
  'escalated.admin.custom-objects.index': { uri: 'escalated/admin/custom-objects', methods: GET },
  'escalated.admin.custom-objects.create': {
    uri: 'escalated/admin/custom-objects/create',
    methods: GET,
  },
  'escalated.admin.custom-objects.store': { uri: 'escalated/admin/custom-objects', methods: POST },
  'escalated.admin.custom-objects.edit': {
    uri: 'escalated/admin/custom-objects/{custom_object}/edit',
    methods: GET,
  },
  'escalated.admin.custom-objects.update': {
    uri: 'escalated/admin/custom-objects/{custom_object}',
    methods: PUT,
  },
  'escalated.admin.custom-objects.destroy': {
    uri: 'escalated/admin/custom-objects/{custom_object}',
    methods: DELETE,
  },
  'escalated.admin.custom-objects.records': {
    uri: 'escalated/admin/custom-objects/{custom_object}/records',
    methods: GET,
  },
  'escalated.admin.custom-objects.records.store': {
    uri: 'escalated/admin/custom-objects/{custom_object}/records',
    methods: POST,
  },
  'escalated.admin.custom-objects.records.update': {
    uri: 'escalated/admin/custom-objects/{custom_object}/records/{record}',
    methods: PUT,
  },
  'escalated.admin.custom-objects.records.destroy': {
    uri: 'escalated/admin/custom-objects/{custom_object}/records/{record}',
    methods: DELETE,
  },
  'escalated.admin.roles.index': { uri: 'escalated/admin/roles', methods: GET },
  'escalated.admin.roles.create': { uri: 'escalated/admin/roles/create', methods: GET },
  'escalated.admin.roles.store': { uri: 'escalated/admin/roles', methods: POST },
  'escalated.admin.roles.edit': { uri: 'escalated/admin/roles/{role}/edit', methods: GET },
  'escalated.admin.roles.update': { uri: 'escalated/admin/roles/{role}', methods: PUT },
  'escalated.admin.roles.destroy': { uri: 'escalated/admin/roles/{role}', methods: DELETE },
  'escalated.admin.users.index': { uri: 'escalated/admin/users', methods: GET },
  'escalated.admin.users.role': { uri: 'escalated/admin/users/{user}/role', methods: PATCH },
  'escalated.admin.users.roles': { uri: 'escalated/admin/users/{user}/roles', methods: PUT },
  'escalated.admin.api-tokens.index': { uri: 'escalated/admin/api-tokens', methods: GET },
  'escalated.admin.api-tokens.store': { uri: 'escalated/admin/api-tokens', methods: POST },
  'escalated.admin.api-tokens.destroy': {
    uri: 'escalated/admin/api-tokens/{token}',
    methods: DELETE,
  },
  'escalated.admin.kb-articles.index': { uri: 'escalated/admin/kb-articles', methods: GET },
  'escalated.admin.kb-articles.create': { uri: 'escalated/admin/kb-articles/create', methods: GET },
  'escalated.admin.kb-articles.store': { uri: 'escalated/admin/kb-articles', methods: POST },
  'escalated.admin.kb-articles.edit': {
    uri: 'escalated/admin/kb-articles/{kb_article}/edit',
    methods: GET,
  },
  'escalated.admin.kb-articles.update': {
    uri: 'escalated/admin/kb-articles/{kb_article}',
    methods: PUT,
  },
  'escalated.admin.kb-articles.destroy': {
    uri: 'escalated/admin/kb-articles/{kb_article}',
    methods: DELETE,
  },
  'escalated.admin.kb-categories.index': { uri: 'escalated/admin/kb-categories', methods: GET },
  'escalated.admin.kb-categories.store': { uri: 'escalated/admin/kb-categories', methods: POST },
  'escalated.admin.kb-categories.update': {
    uri: 'escalated/admin/kb-categories/{kb_category}',
    methods: PUT,
  },
  'escalated.admin.kb-categories.destroy': {
    uri: 'escalated/admin/kb-categories/{kb_category}',
    methods: DELETE,
  },
  'escalated.admin.reports': { uri: 'escalated/admin/reports', methods: GET },
  'escalated.admin.reports.dashboard': { uri: 'escalated/admin/reports/dashboard', methods: GET },
  'escalated.admin.reports.agents': { uri: 'escalated/admin/reports/agents', methods: GET },
  'escalated.admin.reports.sla': { uri: 'escalated/admin/reports/sla', methods: GET },
  'escalated.admin.reports.csat': { uri: 'escalated/admin/reports/csat', methods: GET },
  'escalated.admin.reports.sla-trends': { uri: 'escalated/admin/reports/sla-trends', methods: GET },
  'escalated.admin.reports.frt': { uri: 'escalated/admin/reports/frt', methods: GET },
  'escalated.admin.reports.resolution': { uri: 'escalated/admin/reports/resolution', methods: GET },
  'escalated.admin.reports.response-times': {
    uri: 'escalated/admin/reports/response-times',
    methods: GET,
  },
  'escalated.admin.reports.resolution-times': {
    uri: 'escalated/admin/reports/resolution-times',
    methods: GET,
  },
  'escalated.admin.reports.agent-ranking': {
    uri: 'escalated/admin/reports/agent-ranking',
    methods: GET,
  },
  'escalated.admin.reports.agent-detail': {
    uri: 'escalated/admin/reports/agent/{id}/detail',
    methods: GET,
  },
  'escalated.admin.reports.cohorts': { uri: 'escalated/admin/reports/cohorts', methods: GET },
  'escalated.admin.reports.comparison': { uri: 'escalated/admin/reports/comparison', methods: GET },
  'escalated.admin.reports.export': { uri: 'escalated/admin/reports/export/{type}', methods: GET },
  'escalated.admin.settings': { uri: 'escalated/admin/settings', methods: GET },
  'escalated.admin.settings.update': { uri: 'escalated/admin/settings', methods: POST },
  'escalated.admin.settings.csat': { uri: 'escalated/admin/settings/csat', methods: GET },
  'escalated.admin.settings.csat.update': { uri: 'escalated/admin/settings/csat', methods: POST },
  'escalated.admin.settings.data-retention': {
    uri: 'escalated/admin/settings/data-retention',
    methods: GET,
  },
  'escalated.admin.settings.data-retention.update': {
    uri: 'escalated/admin/settings/data-retention',
    methods: POST,
  },
  'escalated.admin.settings.database': { uri: 'escalated/admin/settings/database', methods: GET },
  'escalated.admin.settings.database.test': {
    uri: 'escalated/admin/settings/database/test',
    methods: POST,
  },
  'escalated.admin.settings.database.update': {
    uri: 'escalated/admin/settings/database',
    methods: POST,
  },
  'escalated.admin.settings.email': { uri: 'escalated/admin/settings/email', methods: GET },
  'escalated.admin.settings.email.update': { uri: 'escalated/admin/settings/email', methods: POST },
  'escalated.admin.settings.public-tickets': {
    uri: 'escalated/admin/settings/public-tickets',
    methods: GET,
  },
  'escalated.admin.settings.public-tickets.update': {
    uri: 'escalated/admin/settings/public-tickets',
    methods: PUT,
  },
  'escalated.admin.departments.index': { uri: 'escalated/admin/departments', methods: GET },
  'escalated.admin.departments.create': { uri: 'escalated/admin/departments/create', methods: GET },
  'escalated.admin.departments.store': { uri: 'escalated/admin/departments', methods: POST },
  'escalated.admin.departments.edit': {
    uri: 'escalated/admin/departments/{department}/edit',
    methods: GET,
  },
  'escalated.admin.departments.update': {
    uri: 'escalated/admin/departments/{department}',
    methods: PUT,
  },
  'escalated.admin.departments.destroy': {
    uri: 'escalated/admin/departments/{department}',
    methods: DELETE,
  },
  // Operations
  'escalated.admin.automations.index': { uri: 'escalated/admin/automations', methods: GET },
  'escalated.admin.automations.create': { uri: 'escalated/admin/automations/create', methods: GET },
  'escalated.admin.automations.store': { uri: 'escalated/admin/automations', methods: POST },
  'escalated.admin.automations.edit': {
    uri: 'escalated/admin/automations/{automation}/edit',
    methods: GET,
  },
  'escalated.admin.automations.update': {
    uri: 'escalated/admin/automations/{automation}',
    methods: PUT,
  },
  'escalated.admin.automations.destroy': {
    uri: 'escalated/admin/automations/{automation}',
    methods: DELETE,
  },
  'escalated.admin.business-hours.index': { uri: 'escalated/admin/business-hours', methods: GET },
  'escalated.admin.business-hours.create': {
    uri: 'escalated/admin/business-hours/create',
    methods: GET,
  },
  'escalated.admin.business-hours.store': { uri: 'escalated/admin/business-hours', methods: POST },
  'escalated.admin.business-hours.edit': {
    uri: 'escalated/admin/business-hours/{business_hour}/edit',
    methods: GET,
  },
  'escalated.admin.business-hours.update': {
    uri: 'escalated/admin/business-hours/{business_hour}',
    methods: PUT,
  },
  'escalated.admin.business-hours.destroy': {
    uri: 'escalated/admin/business-hours/{business_hour}',
    methods: DELETE,
  },
  'escalated.admin.skills.index': { uri: 'escalated/admin/skills', methods: GET },
  'escalated.admin.skills.create': { uri: 'escalated/admin/skills/create', methods: GET },
  'escalated.admin.skills.store': { uri: 'escalated/admin/skills', methods: POST },
  'escalated.admin.skills.edit': { uri: 'escalated/admin/skills/{skill}/edit', methods: GET },
  'escalated.admin.skills.update': { uri: 'escalated/admin/skills/{skill}', methods: PUT },
  'escalated.admin.skills.destroy': { uri: 'escalated/admin/skills/{skill}', methods: DELETE },
  'escalated.admin.capacity.index': { uri: 'escalated/admin/capacity', methods: GET },
  'escalated.admin.capacity.update': { uri: 'escalated/admin/capacity/{capacity}', methods: PUT },
  'escalated.admin.audit-log': { uri: 'escalated/admin/audit-log', methods: GET },
  // Import wizard
  'escalated.admin.import.index': { uri: 'escalated/admin/import', methods: GET },
  'escalated.admin.import.connect': {
    uri: 'escalated/admin/import/{platform}/connect',
    methods: GET,
  },
  'escalated.admin.import.test-connection': {
    uri: 'escalated/admin/import/{platform}/test-connection',
    methods: POST,
  },
  'escalated.admin.import.mapping': {
    uri: 'escalated/admin/import/{platform}/mapping',
    methods: GET,
  },
  'escalated.admin.import.review': {
    uri: 'escalated/admin/import/{platform}/review',
    methods: POST,
  },
  'escalated.admin.import.start': { uri: 'escalated/admin/import/{platform}/start', methods: POST },
  'escalated.admin.import.progress': {
    uri: 'escalated/admin/import/progress/{jobId}',
    methods: GET,
  },
  'escalated.admin.import.status': { uri: 'escalated/admin/import/status/{jobId}', methods: GET },
  'escalated.admin.import.pause': { uri: 'escalated/admin/import/pause/{jobId}', methods: POST },
  'escalated.admin.import.resume': { uri: 'escalated/admin/import/resume/{jobId}', methods: POST },
  'escalated.admin.import.cancel': { uri: 'escalated/admin/import/cancel/{jobId}', methods: POST },
  'escalated.admin.tags.index': { uri: 'escalated/admin/tags', methods: GET },
  'escalated.admin.tags.store': { uri: 'escalated/admin/tags', methods: POST },
  'escalated.admin.tags.update': { uri: 'escalated/admin/tags/{tag}', methods: PUT },
  'escalated.admin.tags.destroy': { uri: 'escalated/admin/tags/{tag}', methods: DELETE },
  'escalated.admin.workflows.index': { uri: 'escalated/admin/workflows', methods: GET },
  'escalated.admin.workflows.create': { uri: 'escalated/admin/workflows/create', methods: GET },
  'escalated.admin.workflows.store': { uri: 'escalated/admin/workflows', methods: POST },
  'escalated.admin.workflows.edit': {
    uri: 'escalated/admin/workflows/{workflow}/edit',
    methods: GET,
  },
  'escalated.admin.workflows.update': {
    uri: 'escalated/admin/workflows/{workflow}',
    methods: PUT,
  },
  'escalated.admin.workflows.destroy': {
    uri: 'escalated/admin/workflows/{workflow}',
    methods: DELETE,
  },
  'escalated.admin.workflows.toggle': {
    uri: 'escalated/admin/workflows/{workflow}/toggle',
    methods: POST,
  },
  'escalated.admin.workflows.logs': { uri: 'escalated/admin/workflows/logs', methods: GET },
  'escalated.admin.workflows.reorder': { uri: 'escalated/admin/workflows/reorder', methods: POST },

  // Two-factor (ADR 2026-10-29): enrolment for every staff user, and the challenge.
  'escalated.admin.two-factor.index': {
    uri: 'escalated/admin/settings/two-factor',
    methods: GET,
  },
  'escalated.admin.two-factor.setup': {
    uri: 'escalated/admin/settings/two-factor/setup',
    methods: POST,
  },
  'escalated.admin.two-factor.confirm': {
    uri: 'escalated/admin/settings/two-factor/confirm',
    methods: POST,
  },
  'escalated.admin.two-factor.disable': {
    uri: 'escalated/admin/settings/two-factor/disable',
    methods: POST,
  },
  'escalated.two-factor.challenge': { uri: 'escalated/two-factor/challenge', methods: GET },
  'escalated.two-factor.verify': { uri: 'escalated/two-factor/challenge', methods: POST },

  // Single sign-on (ADR 2026-10-29): the admin page and the sign-in routes.
  'escalated.admin.settings.sso': { uri: 'escalated/admin/settings/sso', methods: GET },
  'escalated.admin.settings.sso.update': { uri: 'escalated/admin/settings/sso', methods: POST },
  'escalated.sso.login': { uri: 'escalated/sso/login', methods: GET },
  'escalated.sso.saml.metadata': { uri: 'escalated/sso/saml/metadata', methods: GET },
  'escalated.sso.saml.acs': { uri: 'escalated/sso/saml/acs', methods: POST },
  'escalated.sso.oauth.callback': { uri: 'escalated/sso/oauth/callback', methods: GET },
  'escalated.sso.jwt.callback': { uri: 'escalated/sso/jwt/callback', methods: [...GET, ...POST] },

  // Customer
  'escalated.customer.kb.index': { uri: 'escalated/kb', methods: GET },
  'escalated.customer.kb.show': { uri: 'escalated/kb/{slug}', methods: GET },
  'escalated.customer.kb.feedback': { uri: 'escalated/kb/{slug}/feedback', methods: POST },
  'escalated.guest.verification': { uri: 'escalated/guest/verification', methods: POST },
  'escalated.guest.lookup': { uri: 'escalated/guest/lookup', methods: POST },
  'escalated.guest.tickets.create': { uri: 'escalated/guest/create', methods: GET },
  'escalated.guest.tickets.store': { uri: 'escalated/guest', methods: POST },
  'escalated.guest.tickets.show': { uri: 'escalated/guest/{token}', methods: GET },
  'escalated.guest.tickets.reply': { uri: 'escalated/guest/{token}/reply', methods: POST },
  'escalated.guest.tickets.rate': { uri: 'escalated/guest/{token}/rate', methods: POST },
  'escalated.customer.tickets.index': { uri: 'escalated', methods: GET },
  'escalated.customer.tickets.create': { uri: 'escalated/create', methods: GET },
  'escalated.customer.tickets.store': { uri: 'escalated', methods: POST },
  'escalated.customer.tickets.show': {
    uri: 'escalated/customer/tickets/{ticket}',
    methods: GET,
  },
  'escalated.customer.tickets.reply': {
    uri: 'escalated/customer/tickets/{ticket}/reply',
    methods: POST,
  },
  'escalated.customer.tickets.close': {
    uri: 'escalated/customer/tickets/{ticket}/close',
    methods: POST,
  },
  'escalated.customer.tickets.reopen': {
    uri: 'escalated/customer/tickets/{ticket}/reopen',
    methods: POST,
  },
  'escalated.customer.tickets.rate': {
    uri: 'escalated/customer/tickets/{ticket}/rate',
    methods: POST,
  },
  'escalated.agent.tickets.custom-action': {
    uri: 'escalated/agent/tickets/{ticket}/actions/{action}',
    methods: POST,
  },
  // Admin > Plugins. No upload route: plugins are registered in code here.
  'escalated.admin.plugins.index': { uri: 'escalated/admin/plugins', methods: GET },
  'escalated.admin.plugins.activate': {
    uri: 'escalated/admin/plugins/{slug}/activate',
    methods: POST,
  },
  'escalated.admin.plugins.deactivate': {
    uri: 'escalated/admin/plugins/{slug}/deactivate',
    methods: POST,
  },
  'escalated.admin.plugins.destroy': { uri: 'escalated/admin/plugins/{slug}', methods: DELETE },
  // Live chat transfer from Agent/TicketShow's action bar. The name is
  // escalated-laravel's; the endpoint here is the agent chat console's.
  'escalated.admin.chat.transfer': {
    uri: 'escalated/agent/chat/{session}/transfer',
    methods: POST,
  },
  // End Chat from the same action bar; escalated-laravel's name again.
  'escalated.admin.chat.end': {
    uri: 'escalated/agent/chat/{session}/end',
    methods: POST,
  },
};

/** Every named route the screens can call, keyed by name. */
export function escalatedRoutes(): Record<string, NamedRoute> {
  return routes;
}

/** The URL for a named route, like `route(name, params)` on the client. */
export function routeUrl(name: string, params: Record<string, string | number> = {}): string {
  const route = routes[name];
  if (!route) throw new Error(`Unknown Escalated route ${name}`);
  return (
    '/' +
    route.uri.replace(/\{(\w+)\??\}/g, (_, key: string) => encodeURIComponent(String(params[key])))
  );
}
