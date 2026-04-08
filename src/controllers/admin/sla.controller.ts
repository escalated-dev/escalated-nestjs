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
import { SlaService } from '../../services/sla.service';
import { EscalationService } from '../../services/escalation.service';
import { BusinessScheduleService } from '../../services/business-schedule.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

@Controller('escalated/admin/sla')
@UseInterceptors(AuditLogInterceptor)
export class AdminSlaController {
  constructor(
    private readonly slaService: SlaService,
    private readonly escalationService: EscalationService,
    private readonly scheduleService: BusinessScheduleService,
  ) {}

  // SLA Policies
  @Get('policies')
  async listPolicies() {
    return this.slaService.findAll();
  }

  @Get('policies/:id')
  async showPolicy(@Param('id', ParseIntPipe) id: number) {
    return this.slaService.findById(id);
  }

  @Post('policies')
  @AuditAction('create', 'sla_policy')
  async createPolicy(@Body() body: any) {
    return this.slaService.create(body);
  }

  @Put('policies/:id')
  @AuditAction('update', 'sla_policy')
  async updatePolicy(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.slaService.update(id, body);
  }

  @Delete('policies/:id')
  @HttpCode(204)
  @AuditAction('delete', 'sla_policy')
  async deletePolicy(@Param('id', ParseIntPipe) id: number) {
    await this.slaService.delete(id);
  }

  // Escalation Rules
  @Get('escalation-rules')
  async listRules() {
    return this.escalationService.findAll();
  }

  @Post('escalation-rules')
  @AuditAction('create', 'escalation_rule')
  async createRule(@Body() body: any) {
    return this.escalationService.create(body);
  }

  @Put('escalation-rules/:id')
  @AuditAction('update', 'escalation_rule')
  async updateRule(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.escalationService.update(id, body);
  }

  @Delete('escalation-rules/:id')
  @HttpCode(204)
  async deleteRule(@Param('id', ParseIntPipe) id: number) {
    await this.escalationService.delete(id);
  }

  // Business Schedules
  @Get('schedules')
  async listSchedules() {
    return this.scheduleService.findAll();
  }

  @Get('schedules/:id')
  async showSchedule(@Param('id', ParseIntPipe) id: number) {
    return this.scheduleService.findById(id);
  }

  @Post('schedules')
  @AuditAction('create', 'business_schedule')
  async createSchedule(@Body() body: any) {
    return this.scheduleService.create(body);
  }

  @Put('schedules/:id')
  @AuditAction('update', 'business_schedule')
  async updateSchedule(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.scheduleService.update(id, body);
  }

  @Delete('schedules/:id')
  @HttpCode(204)
  async deleteSchedule(@Param('id', ParseIntPipe) id: number) {
    await this.scheduleService.delete(id);
  }

  @Post('schedules/:id/holidays')
  async addHoliday(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.scheduleService.addHoliday(id, body);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  async removeHoliday(@Param('id', ParseIntPipe) id: number) {
    await this.scheduleService.removeHoliday(id);
  }
}
