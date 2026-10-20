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

// Widget embedding
export { WidgetCorsMiddleware } from './middleware/widget-cors.middleware';
export { WIDGET_EMBED_ORIGIN, embedOrigin } from './config/widget-embed';
