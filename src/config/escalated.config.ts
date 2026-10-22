import { TicketAction, TicketActionConfig } from '../contracts/ticket-action.interface';
import { TicketSubject } from '../contracts/ticket-subject.interface';
import { UserId } from './user-id-column';
import type { ThrottlerStorage } from '@nestjs/throttler';

import type { AccountIdentity, AccountReference, TicketActor } from './ticket-access';
import type { EscalatedUiOptions } from '../ui/ui-options';
import type { ImportAdapter } from '../services/import-adapter';
import type { AttachmentStorage } from '../services/email/attachment-downloader.service';

export interface EscalatedModuleOptions {
  visibility?: 'all' | 'department';
  ticketAccess?: {
    /** Resolve authoritative host roles for every authenticated user, including token owners. */
    resolveUser: (id: UserId) => TicketActor | Promise<TicketActor>;
  };
  accounts?: {
    enabled?: boolean;
    scopeAgents?: boolean;
    resolver?: (
      reference: AccountReference,
    ) => AccountIdentity | null | Promise<AccountIdentity | null>;
  };
  targetedSlas?: boolean;

  /**
   * Minutes before an SLA deadline at which `sla.warning` fires, once per
   * deadline (default: 30). Set 0 to turn warnings off.
   */
  slaWarningMinutes?: number;

  /** Route prefix for all Escalated endpoints (default: 'escalated') */
  routePrefix?: string;

  /** User entity class or table name for joins */
  userEntity?: any;

  /**
   * The TypeORM DataSource that Escalated's own tables live on, named as you
   * registered it with `TypeOrmModule.forRoot({ name: '...' })`.
   *
   * Undefined means the default DataSource, which is the historical behaviour
   * and what almost every host wants. Name one when the support tables belong
   * somewhere other than your primary database: a schema shared with a legacy
   * system, a separate reporting or archive store, or simply keeping ticketing
   * data out of the application database.
   *
   * This does NOT move your user entity. The host owns that, and Escalated
   * stores host user ids as plain unconstrained columns precisely so the two
   * can live on different connections.
   */
  connection?: string;

  /** Function to resolve user from request */
  userResolver?: (req: any) => { id: UserId; name?: string; email?: string } | null;

  /**
   * Guard for the admin routes (`/escalated/admin/*`). A `CanActivate` class or
   * instance. A class the host registers as a provider is used as that
   * instance; otherwise it is created with dependency injection.
   *
   * Required to use the admin routes: when unset they refuse every request
   * (403). The guard should set `req.user` (with an `id`) for the acting user.
   */
  adminGuard?: any;

  /**
   * Guard for the agent routes (`/escalated/agent/*`). Same shape and
   * fail-closed behaviour as `adminGuard`. Attachment downloads are admitted
   * by either `agentGuard` or `customerGuard`.
   */
  agentGuard?: any;

  /**
   * Guard for the customer ticket routes (`/escalated/customer/tickets/*`).
   * Same shape and fail-closed behaviour as `adminGuard`. The customer
   * knowledge base stays public.
   */
  customerGuard?: any;

  /** Enable WebSocket broadcasting (default: false) */
  enableWebsockets?: boolean;

  /**
   * Identifies the host user behind a Socket.IO connection (e.g. by verifying
   * a token from `socket.handshake.auth`). Return the user id, or null for a
   * guest. When unset, `userResolver(handshake request)` is used, then a
   * `user` set on the handshake request by host socket middleware.
   *
   * Agent features (agent rooms, the chat queue, new-ticket broadcasts and
   * internal notes) also need `ticketAccess.resolveUser` to confirm the role;
   * without it an identified user is treated as a customer. Connections with
   * neither a user nor a guest token (`handshake.auth.guestToken` /
   * `handshake.auth.chatToken`) are refused.
   */
  websocketAuth?: (socket: any) => UserId | null | undefined | Promise<UserId | null | undefined>;

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
   *   - `replySecret` signs the reply-to token (HMAC-SHA256). When set, inbound
   *     mail is matched to a ticket only through that signed address.
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

  /**
   * Per-client-IP rate limits on the unauthenticated guest endpoints
   * (`POST widget/tickets`, `POST widget/tickets/:id/replies`,
   * `POST widget/chat/start`, and `verification`/`lookup` on the widget and
   * guest routes). A request over
   * the limit gets `429` with `Retry-After`. The client IP is `req.ip`; behind
   * a proxy the host must configure its HTTP adapter's `trust proxy`, or every
   * guest shares the proxy's address.
   */
  guestRateLimit?: {
    /** Default true. Set false only when the host already throttles upstream. */
    enabled?: boolean;
    /** Guest ticket submissions per IP per minute. Default 5. */
    ticketsPerMinute?: number;
    /** Guest replies per IP per minute. Default 10. */
    repliesPerMinute?: number;
    /** Widget chats started per IP per minute. Default 5. */
    chatsPerMinute?: number;
    /** Guest code requests and lookups per IP per minute. Default 10. */
    verificationsPerMinute?: number;
    /**
     * Where the counters live. Default: the in-memory `@nestjs/throttler`
     * store, which is per process. A multi-instance deployment should pass a
     * shared `ThrottlerStorage` (e.g. a Redis-backed one).
     */
    storage?: ThrottlerStorage;
  };

  /**
   * Verified guest access (docs/guest-access.md): guests prove their email
   * with an emailed code and open tickets with expiring grants.
   */
  guestAccess?: {
    /**
     * Key for the email and code digests and the grant encryption. Default:
     * `ESCALATED_GUEST_ACCESS_SECRET`, else `inbound.replySecret`. Without one
     * a random per-process key is used, so grants do not survive a restart
     * and are not shared between instances.
     */
    secret?: string;
    /** Grant lifetime in minutes. Default 1440 (24 h), clamped to 5 minutes .. 7 days. */
    ttlMinutes?: number;
    /** Codes one client IP may request for one mailbox per hour. Default 3. */
    challengesPerClientPerHour?: number;
    /** Codes one mailbox may receive per hour, across clients. Default 10. */
    challengesPerMailboxPerHour?: number;
    /**
     * Keep accepting the permanent guest tokens issued before verified access
     * (`?guest_token=`, `X-Guest-Token`), during a transition. Default false.
     */
    legacyTokens?: boolean;
    /**
     * Delivers a code. Default: the package mailer (`mail`). Hosts may send it
     * their own way.
     */
    sendCode?: (
      email: string,
      code: string,
      purpose: 'ticket' | 'chat' | 'lookup',
    ) => Promise<void> | void;
  };

  /**
   * The shared Vue 3 + Inertia screens (`@escalated-dev/escalated`) for agents,
   * customers and admins. Off by default, which keeps the package API-only;
   * escalated-laravel defaults this to on, and a future minor will too. See
   * docs/ui.md.
   */
  ui?: EscalatedUiOptions;

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

  /**
   * Other sites that may embed the widget: `scheme://host[:port]` origins,
   * optionally `https://*.example.com` for every subdomain (not the apex).
   * Merged with `ESCALATED_WIDGET_ALLOWED_ORIGINS` (comma separated) and the
   * `widget_allowed_origins` admin setting. A bare `*` and entries with a path
   * are ignored. Empty by default: no other site gets CORS access until listed.
   * See docs/embedding-the-widget.md.
   */
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

  /**
   * Sources the admin Import wizard offers (`/escalated/admin/import`), as
   * escalated-laravel's `import.adapters` filter. Escalated ships none: a
   * Zendesk or Freshdesk adapter is the host's or a plugin package's.
   */
  importAdapters?: ImportAdapter[];

  /**
   * Key that seals source credentials between wizard steps and on the job.
   * Default: `guestAccess.secret`, else `ESCALATED_GUEST_ACCESS_SECRET`, else
   * `inbound.replySecret`, else a random per-process key (a restart then
   * drops the credentials of jobs not yet finished).
   */
  importSecret?: string;

  /**
   * The host user with this email, or null. Imported agents must resolve
   * through it; imported contacts that do become those users, the others
   * Escalated contacts.
   */
  importUserIdByEmail?: (email: string) => Promise<UserId | null> | UserId | null;

  /**
   * Hands a started or resumed import to the host's queue, whose worker calls
   * `ImportJobService.run(jobId)`. Default: runs in this process after the
   * response.
   */
  importDispatcher?: (jobId: string) => void;

  /**
   * Stores the bytes of imported attachments (a `LocalFileAttachmentStorage`
   * rooted outside anything the web server serves, or the host's S3/GCS
   * storage); they are served only by the authorised download route. Default:
   * the `ATTACHMENT_STORAGE` provider when one is visible, else none, and then
   * every imported attachment fails.
   */
  importAttachmentStorage?: AttachmentStorage;

  /** Caps one imported attachment, in KB. Default: Laravel's live-upload limit, 10240. */
  importAttachmentMaxKb?: number;
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
  slaWarningMinutes: 30,
  widgetOrigins: [],
  fallbackLanguage: 'en',
  guestRateLimit: {
    enabled: true,
    ticketsPerMinute: 5,
    repliesPerMinute: 10,
  },
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
