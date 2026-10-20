import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { EscalatedSchedulerService } from '../../src/scheduling/escalated-scheduler.service';
import { AutomationService } from '../../src/services/automation.service';
import { Automation } from '../../src/entities/automation.entity';
import { AdminAutomationController } from '../../src/controllers/admin/automation.controller';
import { NewsletterRendererService } from '../../src/services/newsletter/newsletter-renderer.service';
import { NewsletterPermissionService } from '../../src/services/newsletter/newsletter-permission.service';

/**
 * Boots the real EscalatedModule rather than hand-assembling providers, so a
 * service that is injected somewhere but never registered in the module fails
 * here instead of in a host app.
 */
describe('EscalatedModule boot', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('compiles with its default options', async () => {
    moduleRef = await bootEscalatedModule();

    expect(moduleRef.get(EscalatedSchedulerService)).toBeInstanceOf(EscalatedSchedulerService);
  });

  it('registers the automation service, entity and admin controller', async () => {
    moduleRef = await bootEscalatedModule();

    expect(moduleRef.get(AutomationService)).toBeInstanceOf(AutomationService);
    expect(moduleRef.get(getRepositoryToken(Automation))).toBeDefined();
    expect(moduleRef.get(AdminAutomationController)).toBeInstanceOf(AdminAutomationController);
  });

  it('compiles with newsletters enabled', async () => {
    moduleRef = await bootEscalatedModule({ escalated: { enableNewsletters: true } });

    expect(moduleRef.get(NewsletterRendererService)).toBeInstanceOf(NewsletterRendererService);
    expect(moduleRef.get(NewsletterPermissionService)).toBeInstanceOf(NewsletterPermissionService);
  });
});
