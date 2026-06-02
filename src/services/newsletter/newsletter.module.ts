import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../../entities/contact.entity';
import { EscalatedSettings } from '../../entities/escalated-settings.entity';
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
import { NewsletterRendererService } from './newsletter-renderer.service';
import { NewsletterTrackerService } from './newsletter-tracker.service';

/**
 * Optional newsletter feature. Registered by EscalatedModule only when
 * `options.enableNewsletters === true`. Disabled is the default — no
 * entities or services load otherwise.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NewsletterList,
      NewsletterListMember,
      NewsletterTemplate,
      Newsletter,
      NewsletterDelivery,
      Contact,
      EscalatedSettings,
    ]),
  ],
  providers: [
    BounceSuppressionStoreService,
    ContactSegmentResolverService,
    NewsletterRendererService,
    NewsletterPlannerService,
    NewsletterDispatcherService,
    NewsletterTrackerService,
  ],
  exports: [
    BounceSuppressionStoreService,
    ContactSegmentResolverService,
    NewsletterRendererService,
    NewsletterPlannerService,
    NewsletterDispatcherService,
    NewsletterTrackerService,
  ],
})
export class NewsletterModule {}
