// Module
export { EscalatedModule } from './escalated.module';

// Config
export { EscalatedModuleOptions, ESCALATED_OPTIONS } from './config/escalated.config';

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
