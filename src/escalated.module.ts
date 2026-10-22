import { DynamicModule, MiddlewareConsumer, Module, NestModule, Provider } from '@nestjs/common';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DataSource } from 'typeorm';
import {
  TicketAccess,
  TicketAccessInterceptor,
  validateTicketAccess,
} from './config/ticket-access';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailerModule } from '@nestjs-modules/mailer';

import {
  EscalatedModuleOptions,
  ESCALATED_OPTIONS,
  defaultOptions,
} from './config/escalated.config';
import { escalatedRepositoryProviders } from './config/connection';
import { EscalatedI18nModule } from './i18n';
import { NewsletterModule } from './services/newsletter/newsletter.module';

// Entities
import {
  Ticket,
  TicketStatus,
  Reply,
  Attachment,
  TicketActivity,
  Tag,
  Department,
  TicketLink,
  TicketSubjectLink,
  TicketFollower,
  SatisfactionRating,
  SlaPolicy,
  EscalationRule,
  RuleExecution,
  BusinessSchedule,
  Holiday,
  AgentProfile,
  AgentCapacity,
  Skill,
  AgentSkill,
  CannedResponse,
  Macro,
  SideConversation,
  SideConversationReply,
  Role,
  Permission,
  ApiToken,
  Webhook,
  WebhookDelivery,
  AuditLog,
  CustomField,
  CustomFieldValue,
  EscalatedSettings,
  SavedView,
  KbCategory,
  KbArticle,
  ChatSession,
  ChatRoutingRule,
  Contact,
  GuestVerification,
  Workflow,
  WorkflowLog,
  InboundEmail,
  Automation,
} from './entities';

// Services
import {
  TicketService,
  ReplyService,
  SlaService,
  EscalationService,
  RuleFireLog,
  MacroService,
  CannedResponseService,
  CustomFieldService,
  KnowledgeBaseService,
  WebhookService,
  AgentService,
  RoleService,
  ApiTokenService,
  SideConversationService,
  SatisfactionRatingService,
  TwoFactorService,
  ImportService,
  SavedViewService,
  SettingsService,
  TicketLinkService,
  TicketSubjectService,
  AuditLogService,
  DepartmentService,
  TagService,
  SkillService,
  BusinessScheduleService,
  ChatSessionService,
  ChatRoutingService,
  AttachmentService,
  ContactService,
  WorkflowEngineService,
  WorkflowExecutorService,
  WorkflowRunnerService,
  WorkflowAdminService,
  GuestAccessService,
  GuestTicketsService,
  EmailService,
  PostmarkInboundParser,
  MailgunInboundParser,
  SESInboundParser,
  InboundRouterService,
  AutomationService,
  WidgetOriginsService,
} from './services';

import {
  WorkflowListener,
  EmailListener,
  RecordCustomActionInternalNoteListener,
} from './listeners';
import { TicketActionRegistry } from './services/ticket-action-registry.service';
import { InboundEmailController } from './controllers/inbound-email.controller';
import { ApiAuthController } from './controllers/api/auth.controller';
import { InboundWebhookSignatureGuard } from './guards/inbound-webhook-signature.guard';

// Controllers
import { AgentTicketController } from './controllers/agent/ticket.controller';
import { AgentMacroController } from './controllers/agent/macro.controller';
import { AgentSideConversationController } from './controllers/agent/side-conversation.controller';
import { AgentSavedViewController } from './controllers/agent/saved-view.controller';
import { AgentTicketLinkController } from './controllers/agent/ticket-link.controller';
import { AgentTicketSubjectController } from './controllers/agent/ticket-subject.controller';
import { AdminSlaController } from './controllers/admin/sla.controller';
import { AdminAgentController } from './controllers/admin/agent.controller';
import { AdminSettingsController } from './controllers/admin/settings.controller';
import { AdminWebhookController } from './controllers/admin/webhook.controller';
import { AdminApiTokenController } from './controllers/admin/api-token.controller';
import { AdminImportController } from './controllers/admin/import.controller';
import { AdminMacroController } from './controllers/admin/macro.controller';
import { AdminWorkflowController } from './controllers/admin/workflow.controller';
import { GuestController } from './controllers/guest.controller';
import { AdminSkillController } from './controllers/admin/skill.controller';
import { AdminKnowledgeBaseController } from './controllers/admin/knowledge-base.controller';
import { AdminTwoFactorController } from './controllers/admin/two-factor.controller';
import { AdminAutomationController } from './controllers/admin/automation.controller';
import { CustomerTicketController } from './controllers/customer/ticket.controller';
import { CustomerKnowledgeBaseController } from './controllers/customer/knowledge-base.controller';
import { WidgetController } from './controllers/widget/widget.controller';
import { AgentChatController } from './controllers/agent/chat.controller';
import { AttachmentController } from './controllers/agent/attachment.controller';
import { WidgetChatController } from './controllers/widget/chat.controller';
import { WidgetScriptController } from './controllers/widget/widget-script.controller';

// Screens (ui.enabled)
import { uiEnabled } from './ui/ui-options';
import { UiDataService } from './ui/ui-data.service';
import { AgentUiController } from './ui/controllers/agent-ui.controller';
import { CustomerUiController } from './ui/controllers/customer-ui.controller';
import { AdminUiController } from './ui/controllers/admin-ui.controller';
import { AdminTicketsUiController } from './ui/controllers/admin-tickets-ui.controller';
import { AdminConfigUiController } from './ui/controllers/admin-config-ui.controller';
import {
  AdminKnowledgeBaseUiController,
  CustomerKnowledgeBaseUiController,
} from './ui/controllers/knowledge-base-ui.controller';
import { GuestUiController } from './ui/controllers/guest-ui.controller';

// Middleware
import { WidgetCorsMiddleware, routesOf } from './middleware/widget-cors.middleware';

// Guards
import { ApiTokenGuard } from './guards/api-token.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { GuestAccessGuard } from './guards/guest-access.guard';
import { PublicSubmitThrottleGuard } from './guards/public-submit-throttle.guard';
import { GuestThrottleGuard } from './guards/guest-throttle.guard';

// Interceptors
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';

// Scheduling
import { EscalatedSchedulerService } from './scheduling/escalated-scheduler.service';

// Gateway
import { EscalatedGateway } from './gateway/escalated.gateway';

const entities = [
  Ticket,
  TicketStatus,
  Reply,
  Attachment,
  TicketActivity,
  Tag,
  Department,
  TicketLink,
  TicketSubjectLink,
  TicketFollower,
  SatisfactionRating,
  SlaPolicy,
  EscalationRule,
  RuleExecution,
  BusinessSchedule,
  Holiday,
  AgentProfile,
  AgentCapacity,
  Skill,
  AgentSkill,
  CannedResponse,
  Macro,
  SideConversation,
  SideConversationReply,
  Role,
  Permission,
  ApiToken,
  Webhook,
  WebhookDelivery,
  AuditLog,
  CustomField,
  CustomFieldValue,
  EscalatedSettings,
  SavedView,
  KbCategory,
  KbArticle,
  ChatSession,
  ChatRoutingRule,
  Contact,
  GuestVerification,
  Workflow,
  WorkflowLog,
  InboundEmail,
  Automation,
];

const services = [
  TicketService,
  ReplyService,
  SlaService,
  EscalationService,
  RuleFireLog,
  MacroService,
  CannedResponseService,
  CustomFieldService,
  KnowledgeBaseService,
  WebhookService,
  AgentService,
  RoleService,
  ApiTokenService,
  SideConversationService,
  SatisfactionRatingService,
  TwoFactorService,
  ImportService,
  SavedViewService,
  SettingsService,
  TicketLinkService,
  TicketSubjectService,
  AuditLogService,
  DepartmentService,
  TagService,
  SkillService,
  BusinessScheduleService,
  ChatSessionService,
  ChatRoutingService,
  AttachmentService,
  ContactService,
  WorkflowEngineService,
  WorkflowExecutorService,
  WorkflowRunnerService,
  WorkflowAdminService,
  GuestAccessService,
  GuestTicketsService,
  EmailService,
  PostmarkInboundParser,
  MailgunInboundParser,
  SESInboundParser,
  InboundRouterService,
  AutomationService,
  WidgetOriginsService,
];

const controllers = [
  AgentTicketController,
  AgentMacroController,
  AgentSideConversationController,
  AgentSavedViewController,
  AgentTicketLinkController,
  AgentTicketSubjectController,
  AdminSlaController,
  AdminAgentController,
  AdminSettingsController,
  AdminWebhookController,
  AdminApiTokenController,
  AdminImportController,
  AdminMacroController,
  AdminSkillController,
  AdminKnowledgeBaseController,
  AdminTwoFactorController,
  AdminAutomationController,
  AdminWorkflowController,
  CustomerTicketController,
  CustomerKnowledgeBaseController,
  WidgetController,
  GuestController,
  AgentChatController,
  WidgetChatController,
  WidgetScriptController,
  AttachmentController,
  InboundEmailController,
  ApiAuthController,
];

@Module({})
export class EscalatedModule implements NestModule {
  /**
   * CORS for embedding the widget on other sites, on every widget and widget
   * chat route (not on `embed.js`, which is public to every origin).
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(WidgetCorsMiddleware)
      .forRoutes(...routesOf(WidgetController, WidgetChatController));
  }

  static forRoot(options: EscalatedModuleOptions = {}): DynamicModule {
    const mergedOptions = { ...defaultOptions, ...options };
    validateTicketAccess(mergedOptions);

    const optionsProvider: Provider = {
      provide: ESCALATED_OPTIONS,
      useValue: mergedOptions,
    };

    // Build the ticket action registry from config at bootstrap, mirroring the
    // singleton registration used by the other host frameworks.
    const ticketActionRegistryProvider: Provider = {
      provide: TicketActionRegistry,
      useFactory: (opts: EscalatedModuleOptions) => {
        const registry = new TicketActionRegistry();
        for (const action of opts.ticketActions?.actions ?? []) {
          registry.register(action);
        }
        return registry;
      },
      inject: [ESCALATED_OPTIONS],
    };

    const conditionalProviders: Provider[] = [];
    const conditionalControllers: any[] = [...controllers];

    // WebSocket gateway (opt-in)
    if (mergedOptions.enableWebsockets) {
      conditionalProviders.push(EscalatedGateway);
    }

    // The shared screens' own routes (headless when off, the default).
    if (uiEnabled(mergedOptions)) {
      conditionalControllers.push(
        AgentUiController,
        CustomerUiController,
        AdminUiController,
        AdminTicketsUiController,
        AdminConfigUiController,
        AdminKnowledgeBaseUiController,
        CustomerKnowledgeBaseUiController,
        GuestUiController,
      );
    }

    return {
      module: EscalatedModule,
      imports: [
        // Registered against the host's chosen DataSource. Undefined is the
        // default one, so an unconfigured host is unchanged.
        TypeOrmModule.forFeature(entities, mergedOptions.connection),
        ScheduleModule.forRoot(),
        // Wildcards let WebhookService subscribe to `escalated.**`. Every event
        // name is dot-delimited and contains no `*`, so exact-name listeners
        // still match only their own event.
        EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
        EscalatedI18nModule.forRoot({
          fallbackLanguage: mergedOptions.fallbackLanguage,
          hostOverridesPath: mergedOptions.i18nOverridesPath,
        }),
        ...(mergedOptions.mail
          ? [
              MailerModule.forRoot({
                transport: mergedOptions.mail.transport as never,
                defaults: { from: mergedOptions.mail.from },
              }),
            ]
          : []),
        // Newsletter system (optional, disabled by default). When the flag is
        // false the module isn't added to imports — entities don't register
        // and services don't instantiate.
        ...(mergedOptions.enableNewsletters ? [NewsletterModule.forRoot(mergedOptions)] : []),
      ],
      controllers: conditionalControllers,
      providers: [
        optionsProvider,
        {
          provide: TicketAccess,
          useFactory: (source: DataSource) => new TicketAccess(source, mergedOptions),
          inject: [getDataSourceToken(mergedOptions.connection)],
        },
        {
          provide: APP_INTERCEPTOR,
          useFactory: (access: TicketAccess) => new TicketAccessInterceptor(access),
          inject: [TicketAccess],
        },
        ticketActionRegistryProvider,
        // Aliases the default repository tokens onto the named DataSource, so
        // the package's 164 `@InjectRepository(X)` sites need no change. Empty
        // when no connection is configured.
        ...escalatedRepositoryProviders(entities, mergedOptions.connection),
        ...services,
        UiDataService,
        ...conditionalProviders,
        ApiTokenGuard,
        PermissionsGuard,
        GuestAccessGuard,
        PublicSubmitThrottleGuard,
        GuestThrottleGuard,
        InboundWebhookSignatureGuard,
        AuditLogInterceptor,
        EscalatedSchedulerService,
        WorkflowListener,
        EmailListener,
        RecordCustomActionInternalNoteListener,
      ],
      exports: [
        TicketAccess,
        ...services,
        optionsProvider,
        ticketActionRegistryProvider,
        TypeOrmModule,
      ],
    };
  }
}
