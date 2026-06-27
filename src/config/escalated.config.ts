import { TicketAction, TicketActionConfig } from '../contracts/ticket-action.interface';
import { TicketSubject } from '../contracts/ticket-subject.interface';
import { UserId } from './user-id-column';

export interface EscalatedModuleOptions {
  /** Route prefix for all Escalated endpoints (default: 'escalated') */
  routePrefix?: string;

  /** User entity class or table name for joins */
  userEntity?: any;

  /** Function to resolve user from request */
  userResolver?: (req: any) => { id: UserId; name?: string; email?: string } | null;

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
    | { mode: 'guest_user'; guestUserId: UserId }
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

  /**
   * Newsletter system. Disabled by default. When `enableNewsletters` is
   * false, the NewsletterModule is not imported, no entities are
   * registered, and the scheduler tick does not run.
   */
  enableNewsletters?: boolean;

  newsletters?: {
    defaultFrom?: string;
    defaultReplyTo?: string;
    defaultTheme?: string;
    /** Sends per minute. Default 60. */
    rateLimitPerMinute?: number;
    /** Deliveries pulled per dispatcher tick. Default 50. */
    batchSize?: number;
    /** When false, the renderer skips pixel injection and click rewriting. */
    trackingEnabled?: boolean;
    /** Bounce rate at which a campaign auto-pauses. Default 0.05 (5%). */
    autoPauseBounceRate?: number;
    /** Minimum deliveries before auto-pause kicks in. Default 100. */
    autoPauseThreshold?: number;
    /** Reclaim `queued` rows older than this. Default 10 minutes. */
    claimTimeoutMinutes?: number;
    /** Absolute path to a directory containing `<slug>.hbs` theme files. */
    themesDir?: string;
    brand?: {
      name?: string;
      accent?: string;
      logoUrl?: string;
      physicalAddress?: string;
    };
  };

  /**
   * Host-defined custom ticket actions. Each visible action renders as a button
   * on the agent ticket screen and, when clicked, dispatches the
   * `TicketCustomActionTriggered` event. Actions may be objects implementing
   * the `TicketAction` interface or plain `TicketActionConfig` objects.
   */
  ticketActions?: {
    actions?: (TicketAction | TicketActionConfig)[];
  };

  /**
   * Host-app entities a ticket can be *about* (Project, Customer, asset, …).
   * `types` is the allowlist for the agent API; `resolver` maps a stored
   * type/id pair to a {@link TicketSubject} for serialization.
   */
  ticketSubjects?: {
    types?: string[];
    resolver?: (type: string, id: string) => Promise<TicketSubject | null>;
  };

  /**
   * Host-app authentication callbacks for the general JSON API
   * (`/api/v1/auth/*`) consumed by the Flutter app. Escalated owns no
   * credentials or sessions, so it ships no password-hashing dependency; the
   * host implements only the callbacks it needs. Each returns the JSON payload
   * to send (e.g. token + user) on success, or `null` for an auth failure
   * (401). An unconfigured callback responds `501`.
   */
  apiAuth?: {
    authenticate?: (params: Record<string, any>) => Promise<Record<string, any> | null>;
    register?: (params: Record<string, any>) => Promise<Record<string, any> | null>;
    validate?: (token: string) => Promise<Record<string, any> | null>;
    refresh?: (token: string) => Promise<Record<string, any> | null>;
    updateProfile?: (
      token: string,
      attrs: Record<string, any>,
    ) => Promise<Record<string, any> | null>;
    logout?: (token: string) => Promise<void>;
  };
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
  enableNewsletters: false,
  newsletters: {
    defaultTheme: 'default',
    rateLimitPerMinute: 60,
    batchSize: 50,
    trackingEnabled: true,
    autoPauseBounceRate: 0.05,
    autoPauseThreshold: 100,
    claimTimeoutMinutes: 10,
  },
  ticketActions: {
    actions: [],
  },
  ticketSubjects: {
    types: [],
  },
};
