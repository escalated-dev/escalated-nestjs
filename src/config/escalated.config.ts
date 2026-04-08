export interface EscalatedModuleOptions {
  /** Route prefix for all Escalated endpoints (default: 'escalated') */
  routePrefix?: string;

  /** User entity class or table name for joins */
  userEntity?: any;

  /** Function to resolve user from request */
  userResolver?: (req: any) => { id: number; name?: string; email?: string } | null;

  /** Guard class for admin routes */
  adminGuard?: any;

  /** Guard class for agent routes */
  agentGuard?: any;

  /** Guard class for customer routes */
  customerGuard?: any;

  /** Enable WebSocket broadcasting (default: false) */
  enableWebsockets?: boolean;

  /** Enable knowledge base feature (default: true) */
  enableKnowledgeBase?: boolean;

  /** Enable CSAT surveys (default: true) */
  enableCsat?: boolean;

  /** Enable 2FA for agents (default: false) */
  enable2fa?: boolean;

  /** Email sender address */
  emailFrom?: string;

  /** App name for branding */
  appName?: string;

  /** App URL for links in emails */
  appUrl?: string;

  /** Max file upload size in bytes (default: 10MB) */
  maxFileSize?: number;

  /** Allowed file types */
  allowedFileTypes?: string[];

  /** Webhook retry attempts (default: 3) */
  webhookMaxRetries?: number;

  /** Widget allowed origins (CORS) */
  widgetOrigins?: string[];
}

export const ESCALATED_OPTIONS = 'ESCALATED_OPTIONS';

export const defaultOptions: EscalatedModuleOptions = {
  routePrefix: 'escalated',
  enableWebsockets: false,
  enableKnowledgeBase: true,
  enableCsat: true,
  enable2fa: false,
  appName: 'Escalated',
  maxFileSize: 10 * 1024 * 1024,
  allowedFileTypes: ['image/*', 'application/pdf', 'text/*', '.doc', '.docx', '.xls', '.xlsx'],
  webhookMaxRetries: 3,
  widgetOrigins: ['*'],
};
