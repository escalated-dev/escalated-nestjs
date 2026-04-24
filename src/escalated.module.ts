import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

import {
  EscalatedModuleOptions,
  ESCALATED_OPTIONS,
  defaultOptions,
} from './config/escalated.config';

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
  SatisfactionRating,
  SlaPolicy,
  EscalationRule,
  BusinessSchedule,
  Holiday,
  AgentProfile,
  AgentCapacity,
  Skill,
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
} from './entities';

// Services
import {
  TicketService,
  ReplyService,
  SlaService,
  EscalationService,
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
  AuditLogService,
  DepartmentService,
  TagService,
  SkillService,
  BusinessScheduleService,
  ChatSessionService,
  ChatRoutingService,
  AttachmentService,
  ContactService,
} from './services';

// Controllers
import { AgentTicketController } from './controllers/agent/ticket.controller';
import { AgentMacroController } from './controllers/agent/macro.controller';
import { AgentSideConversationController } from './controllers/agent/side-conversation.controller';
import { AgentSavedViewController } from './controllers/agent/saved-view.controller';
import { AgentTicketLinkController } from './controllers/agent/ticket-link.controller';
import { AdminSlaController } from './controllers/admin/sla.controller';
import { AdminAgentController } from './controllers/admin/agent.controller';
import { AdminSettingsController } from './controllers/admin/settings.controller';
import { AdminWebhookController } from './controllers/admin/webhook.controller';
import { AdminApiTokenController } from './controllers/admin/api-token.controller';
import { AdminImportController } from './controllers/admin/import.controller';
import { AdminMacroController } from './controllers/admin/macro.controller';
import { AdminKnowledgeBaseController } from './controllers/admin/knowledge-base.controller';
import { AdminTwoFactorController } from './controllers/admin/two-factor.controller';
import { CustomerTicketController } from './controllers/customer/ticket.controller';
import { CustomerKnowledgeBaseController } from './controllers/customer/knowledge-base.controller';
import { WidgetController } from './controllers/widget/widget.controller';
import { AgentChatController } from './controllers/agent/chat.controller';
import { AttachmentController } from './controllers/agent/attachment.controller';
import { WidgetChatController } from './controllers/widget/chat.controller';

// Guards
import { ApiTokenGuard } from './guards/api-token.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { GuestAccessGuard } from './guards/guest-access.guard';

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
  SatisfactionRating,
  SlaPolicy,
  EscalationRule,
  BusinessSchedule,
  Holiday,
  AgentProfile,
  AgentCapacity,
  Skill,
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
];

const services = [
  TicketService,
  ReplyService,
  SlaService,
  EscalationService,
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
  AuditLogService,
  DepartmentService,
  TagService,
  SkillService,
  BusinessScheduleService,
  ChatSessionService,
  ChatRoutingService,
  AttachmentService,
  ContactService,
];

const controllers = [
  AgentTicketController,
  AgentMacroController,
  AgentSideConversationController,
  AgentSavedViewController,
  AgentTicketLinkController,
  AdminSlaController,
  AdminAgentController,
  AdminSettingsController,
  AdminWebhookController,
  AdminApiTokenController,
  AdminImportController,
  AdminMacroController,
  AdminKnowledgeBaseController,
  AdminTwoFactorController,
  CustomerTicketController,
  CustomerKnowledgeBaseController,
  WidgetController,
  AgentChatController,
  WidgetChatController,
  AttachmentController,
];

@Module({})
export class EscalatedModule {
  static forRoot(options: EscalatedModuleOptions = {}): DynamicModule {
    const mergedOptions = { ...defaultOptions, ...options };

    const optionsProvider: Provider = {
      provide: ESCALATED_OPTIONS,
      useValue: mergedOptions,
    };

    const conditionalProviders: Provider[] = [];
    const conditionalControllers: any[] = [...controllers];

    // WebSocket gateway (opt-in)
    if (mergedOptions.enableWebsockets) {
      conditionalProviders.push(EscalatedGateway);
    }

    return {
      module: EscalatedModule,
      imports: [
        TypeOrmModule.forFeature(entities),
        ScheduleModule.forRoot(),
        EventEmitterModule.forRoot(),
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
      ],
      controllers: conditionalControllers,
      providers: [
        optionsProvider,
        ...services,
        ...conditionalProviders,
        ApiTokenGuard,
        PermissionsGuard,
        GuestAccessGuard,
        AuditLogInterceptor,
        EscalatedSchedulerService,
      ],
      exports: [...services, optionsProvider, TypeOrmModule],
    };
  }
}
