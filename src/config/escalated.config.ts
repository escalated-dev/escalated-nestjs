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

  /** Email sender address (legacy — prefer `mail.from`). */
  emailFrom?: string;

  /**
   * Structured outbound mail configuration. When present, the module
   * registers `@nestjs-modules/mailer` with the given transport.
   */
  mail?: {
    from: string;
    transport:
      | {
          host: string;
          port: number;
          auth: { user: string; pass: string };
          secure?: boolean;
        }
      | {
          service: 'postmark' | 'sendgrid' | 'mailgun';
          auth: { user: string; pass: string };
        };
  };

  /**
   * Inbound email ingress configuration.
   *   - `replyDomain` is the host of the signed Reply-To address.
   *   - `replySecret` signs the reply-to token (HMAC-SHA256).
   *   - `webhookSecret` authenticates provider webhook calls.
   */
  inbound?: {
    replyDomain: string;
    replySecret: string;
    webhookSecret: string;
    provider?: 'postmark' | 'mailgun' | 'sendgrid';
  };

  /**
   * Default guest identity policy for public (anonymous) ticket submission.
   *   - `unassigned`: ticket.requesterId = 0. Contact carries the identity.
   *   - `guest_user`: ticket.requesterId = guestUserId (single shared host user).
   *   - `prompt_signup`: ticket.requesterId = 0; emit a signup invite event.
   *
   * Admins may override this at runtime via the settings store.
   */
  guestPolicy?:
    | { mode: 'unassigned' }
    | { mode: 'guest_user'; guestUserId: number }
    | { mode: 'prompt_signup'; signupUrlTemplate?: string };

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

  /**
   * Fallback language for i18n when none is detected from the request
   * (default: `'en'`). The full set of supported languages comes from
   * the central `@escalated-dev/locale` package.
   */
  fallbackLanguage?: string;

  /**
   * Absolute path to a host-app override directory for translations.
   * Files placed here win over both the central package and the
   * in-repo overrides, namespaced by `<lang>/<namespace>.json`.
   */
  i18nOverridesPath?: string;
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
  fallbackLanguage: 'en',
};
