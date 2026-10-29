// Module
export { EscalatedModule } from './escalated.module';

// Contracts
export { TicketSubject } from './contracts/ticket-subject.interface';

// Config
export {
  EscalatedModuleOptions,
  ESCALATED_OPTIONS,
  userKeyType,
  userIdColumn,
  userIdColumnType,
  UserId,
  UserKeyType,
} from './config';

// Entities
export * from './entities';
export {
  STATUS_CATEGORIES,
  StatusCategory,
  SYSTEM_STATUS_SLUGS,
  statusCategory,
  isSolvedStatus,
} from './entities/status-category';

// Services
export * from './services';

// DTOs
export * from './dto';

// Guards
export * from './guards';

// Events
export * from './events/escalated.events';

// Interceptors
export { AuditLogInterceptor, AuditAction } from './interceptors/audit-log.interceptor';

// i18n
export { EscalatedI18nModule, EscalatedI18nOptions, ChainedI18nLoader } from './i18n';

export {
  TicketAccess,
  TicketActor,
  AccountIdentity,
  AccountReference,
} from './config/ticket-access';
export { TicketAccessAndRouting1791918000000 } from './migrations/1791918000000-TicketAccessAndRouting';
export { WidgetTicketMetadata1792281600000 } from './migrations/1792281600000-WidgetTicketMetadata';
export { WidgetChatVisitorToken1792368000000 } from './migrations/1792368000000-WidgetChatVisitorToken';
export { SlaBreachFlags1792454400000 } from './migrations/1792454400000-SlaBreachFlags';
export { SlaWarningFlags1792540800000 } from './migrations/1792540800000-SlaWarningFlags';
export { VerifiedGuestAccess1792627200000 } from './migrations/1792627200000-VerifiedGuestAccess';
export { EscalationRuleContract1792713600000 } from './migrations/1792713600000-EscalationRuleContract';
export { BusinessSchedulePrecedence1792800000000 } from './migrations/1792800000000-BusinessSchedulePrecedence';
export { TicketStatusCategories1792886400000 } from './migrations/1792886400000-TicketStatusCategories';
export { CustomFieldsAndObjects1792972800000 } from './migrations/1792972800000-CustomFieldsAndObjects';
export { ImportJobs1793059200000 } from './migrations/1793059200000-ImportJobs';
export { HashApiTokens1793145600000 } from './migrations/1793145600000-HashApiTokens';
export { ChatVisitorTokenExpiry1793232000000 } from './migrations/1793232000000-ChatVisitorTokenExpiry';
export { Plugins1793318400000 } from './migrations/1793318400000-Plugins';
export * from './events/event-names';

// Widget embedding
export { WidgetCorsMiddleware } from './middleware/widget-cors.middleware';
export { WIDGET_EMBED_ORIGIN, embedOrigin } from './config/widget-embed';

// Screens (ui.enabled)
export {
  EscalatedUiHostUser,
  EscalatedUiOptions,
  EscalatedUiRoleChange,
  EscalatedUiUser,
  EscalatedUiUserPage,
  EscalatedUiUserQuery,
  InertiaPageObject,
} from './ui/ui-options';
export { InertiaPage, InertiaRedirect, inertia, redirect, back } from './ui/inertia';
export { EscalatedUi, InertiaInterceptor, InertiaReplyFilter } from './ui/inertia.interceptor';
export { defaultRootView, ROUTE_HELPER } from './ui/root-view';
export { escalatedRoutes } from './ui/routes';

// Plugins
export * from './plugins/plugin-definition';
export {
  PluginRegistry,
  PluginListing,
  PLUGIN_LIFECYCLE_ACTIONS,
} from './plugins/plugin-registry.service';
export { PluginStoreService } from './plugins/plugin-store.service';
