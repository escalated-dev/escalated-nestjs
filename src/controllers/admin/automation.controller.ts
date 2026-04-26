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
} from '@nestjs/common';
import { AutomationService } from '../../services/automation.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

/**
 * Admin CRUD for time-based automation rules.
 *
 * The runner itself is invoked via the cron tick (`AutomationCron`), not
 * via this controller. This controller only manages the rule definitions.
 */
@Controller('escalated/admin')
@UseInterceptors(AuditLogInterceptor)
export class AdminAutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Get('automations')
  async list() {
    return this.automationService.findAll();
  }

  @Get('automations/:id')
  async show(@Param('id', ParseIntPipe) id: number) {
    return this.automationService.findById(id);
  }

  @Post('automations')
  @AuditAction('create', 'automation')
  async create(@Body() body: any) {
    return this.automationService.create(body);
  }

  @Put('automations/:id')
  @AuditAction('update', 'automation')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.automationService.update(id, body);
  }

  @Delete('automations/:id')
  @HttpCode(204)
  @AuditAction('delete', 'automation')
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.automationService.delete(id);
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
