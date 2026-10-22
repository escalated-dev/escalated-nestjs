import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  UseInterceptors,
  UseGuards,
  Inject,
  NotFoundException,
  Optional,
  Req,
} from '@nestjs/common';
import { AutomationService } from '../../services/automation.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { automationInput, serializeAutomation } from '../../ui/admin-operations';
import { inertia, redirect } from '../../ui/inertia';
import { BrowserFormGuard, EscalatedUi } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';

/**
 * Admin CRUD for time-based automation rules.
 *
 * The runner itself is invoked via the cron tick (`AutomationCron`), not
 * via this controller. This controller only manages the rule definitions.
 *
 * With `ui.enabled`, the same routes also serve `Escalated/Admin/Automations/
 * Index` and `Form` (plus `create` and `:id/edit`), as escalated-laravel's
 * Admin\AutomationController does, answering the form with redirects. API
 * clients keep the JSON.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminAutomationController {
  constructor(
    private readonly automationService: AutomationService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return wantsPage(this.options, req);
  }

  private toIndex(message: string) {
    return redirect(routeUrl('escalated.admin.automations.index'), { success: message });
  }

  @Get('automations')
  async list(@Req() req?: any): Promise<any> {
    const automations = await this.automationService.findAll();
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Automations/Index', {
        automations: automations.map(serializeAutomation),
      });
    }
    return automations;
  }

  /** The new-automation screen (`ui.enabled` only). Declared before `:id`. */
  @Get('automations/create')
  createForm(@Req() req?: any) {
    if (!this.screen(req)) throw new NotFoundException();
    return inertia('Escalated/Admin/Automations/Form', { automation: null });
  }

  /** The edit screen (`ui.enabled` only). */
  @Get('automations/:id/edit')
  async edit(@Param('id', ParseIntPipe) id: number, @Req() req?: any) {
    if (!this.screen(req)) throw new NotFoundException();
    return inertia('Escalated/Admin/Automations/Form', {
      automation: serializeAutomation(await this.automationService.findById(id)),
    });
  }

  @Get('automations/:id')
  async show(@Param('id', ParseIntPipe) id: number) {
    return this.automationService.findById(id);
  }

  @Post('automations')
  @AuditAction('create', 'automation')
  async create(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      const input = automationInput(body);
      const last = (await this.automationService.findAll()).reduce(
        (max, row) => Math.max(max, row.position ?? 0),
        0,
      );
      await this.automationService.create({ ...input, position: last + 1 });
      return this.toIndex('Automation created.');
    }
    return this.automationService.create(body);
  }

  @Put('automations/:id')
  @AuditAction('update', 'automation')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      await this.automationService.update(id, automationInput(body));
      return this.toIndex('Automation updated.');
    }
    return this.automationService.update(id, body);
  }

  @Delete('automations/:id')
  @HttpCode(204)
  @AuditAction('delete', 'automation')
  async delete(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.automationService.delete(id);
    if (this.screen(req)) return this.toIndex('Automation deleted.');
  }

  /**
   * Manually trigger an immediate run of all active automations.
   * Useful for admin smoke-testing without waiting for the next cron tick.
   * Returns the count of (automation × ticket) action applications.
   */
  @Post('automations/run')
  @AuditAction('run', 'automation')
  async runNow() {
    const affected = await this.automationService.run();
    return { affected };
  }
}
