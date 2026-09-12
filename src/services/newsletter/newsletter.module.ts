import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { escalatedRepositoryProviders } from '../../config/connection';
import { AgentProfile } from '../../entities/agent-profile.entity';
import { Contact } from '../../entities/contact.entity';
import { EscalatedSettings } from '../../entities/escalated-settings.entity';
import { Role } from '../../entities/role.entity';
import { AdminNewsletterController } from '../../controllers/newsletter/admin-newsletter.controller';
import { AdminNewsletterListController } from '../../controllers/newsletter/admin-newsletter-list.controller';
import { AdminNewsletterSettingsController } from '../../controllers/newsletter/admin-newsletter-settings.controller';
import { AdminNewsletterTemplateController } from '../../controllers/newsletter/admin-newsletter-template.controller';
import {
  NewsletterEspWebhookController,
  NewsletterPublicController,
} from '../../controllers/newsletter/newsletter-public.controller';
import { NewsletterEnabledGuard } from '../../guards/newsletter-enabled.guard';
import {
  Newsletter,
  NewsletterDelivery,
  NewsletterList,
  NewsletterListMember,
  NewsletterTemplate,
} from '../../entities/newsletter';
import { BounceSuppressionStoreService } from './bounce-suppression-store.service';
import { ContactSegmentResolverService } from './contact-segment-resolver.service';
import { NewsletterDispatcherService } from './newsletter-dispatcher.service';
import { NewsletterPlannerService } from './newsletter-planner.service';
import { NewsletterPermissionService } from './newsletter-permission.service';
import { NewsletterRendererService } from './newsletter-renderer.service';
import { NewsletterTrackerService } from './newsletter-tracker.service';

/**
 * Optional newsletter feature. Registered by EscalatedModule only when
 * `options.enableNewsletters === true`. Disabled is the default — no
 * entities or services load otherwise.
 *
 * Dynamic rather than static so it can be told which DataSource Escalated's
 * tables live on. Its entities are part of the same schema as the rest of the
 * package and must not be left behind on the default connection when the host
 * has moved everything else.
 */
const newsletterEntities = [
  NewsletterList,
  NewsletterListMember,
  NewsletterTemplate,
  Newsletter,
  NewsletterDelivery,
  Contact,
  EscalatedSettings,
  AgentProfile,
  Role,
];

const newsletterControllers = [
  AdminNewsletterListController,
  AdminNewsletterTemplateController,
  AdminNewsletterSettingsController,
  AdminNewsletterController,
  NewsletterPublicController,
  NewsletterEspWebhookController,
];

const newsletterServices = [
  BounceSuppressionStoreService,
  ContactSegmentResolverService,
  NewsletterRendererService,
  NewsletterPlannerService,
  NewsletterDispatcherService,
  NewsletterTrackerService,
  NewsletterPermissionService,
];

@Module({})
export class NewsletterModule {
  static forRoot(connection?: string): DynamicModule {
    return {
      module: NewsletterModule,
      imports: [TypeOrmModule.forFeature(newsletterEntities, connection)],
      controllers: newsletterControllers,
      providers: [
        ...escalatedRepositoryProviders(newsletterEntities, connection),
        ...newsletterServices,
        NewsletterEnabledGuard,
      ],
      exports: [TypeOrmModule, ...newsletterServices],
    };
  }
}
