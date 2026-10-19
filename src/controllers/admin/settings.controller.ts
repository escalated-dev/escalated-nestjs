import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  BadRequestException,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { SettingsService } from '../../services/settings.service';
import { DepartmentService } from '../../services/department.service';
import { TagService } from '../../services/tag.service';
import { CustomFieldService } from '../../services/custom-field.service';
import { RoleService } from '../../services/role.service';
import { AuditLogService } from '../../services/audit-log.service';
import {
  WIDGET_ALLOWED_ORIGINS_SETTING,
  invalidOriginEntries,
} from '../../services/widget-origins.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';

@UseGuards(EscalatedAdminGuard)
@Controller('escalated/admin')
@UseInterceptors(AuditLogInterceptor)
export class AdminSettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly departmentService: DepartmentService,
    private readonly tagService: TagService,
    private readonly customFieldService: CustomFieldService,
    private readonly roleService: RoleService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // Settings
  @Get('settings')
  async listSettings(@Query('group') group?: string) {
    return this.settingsService.getAll(group);
  }

  @Put('settings')
  @AuditAction('update', 'settings')
  async updateSettings(@Body() body: { key: string; value: any; type?: string; group?: string }[]) {
    const settings = (Array.isArray(body) ? body : []).map((setting) =>
      setting?.key === WIDGET_ALLOWED_ORIGINS_SETTING
        ? this.widgetOriginsSetting(setting)
        : setting,
    );
    await this.settingsService.setMany(settings);
    return { success: true };
  }

  /**
   * `widget_allowed_origins`: one origin per line (or comma separated), each
   * `scheme://host[:port]` or `https://*.example.com`. A list is stored as
   * newline-separated text. Rejects the whole update if any entry is invalid.
   */
  private widgetOriginsSetting<T extends { value: any }>(setting: T): T {
    const value = setting.value ?? '';
    const isList = Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    if (typeof value !== 'string' && !isList) {
      throw new BadRequestException([
        `${WIDGET_ALLOWED_ORIGINS_SETTING} must be text with one origin per line`,
      ]);
    }
    const invalid = invalidOriginEntries(value);
    if (invalid.length > 0) {
      throw new BadRequestException([
        `${WIDGET_ALLOWED_ORIGINS_SETTING} must list origins such as https://shop.example.com ` +
          `or https://*.example.com, without a path; not valid: ${invalid.join(', ')}`,
      ]);
    }
    return { ...setting, value: isList ? value.join('\n') : value, type: 'string' };
  }

  // Departments
  @Get('departments')
  async listDepartments() {
    return this.departmentService.findAll();
  }

  @Post('departments')
  @AuditAction('create', 'department')
  async createDepartment(@Body() body: any) {
    return this.departmentService.create(body);
  }

  @Put('departments/:id')
  @AuditAction('update', 'department')
  async updateDepartment(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.departmentService.update(id, body);
  }

  @Delete('departments/:id')
  @HttpCode(204)
  async deleteDepartment(@Param('id', ParseIntPipe) id: number) {
    await this.departmentService.delete(id);
  }

  // Tags
  @Get('tags')
  async listTags() {
    return this.tagService.findAll();
  }

  @Post('tags')
  @AuditAction('create', 'tag')
  async createTag(@Body() body: any) {
    return this.tagService.create(body);
  }

  @Put('tags/:id')
  async updateTag(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.tagService.update(id, body);
  }

  @Delete('tags/:id')
  @HttpCode(204)
  async deleteTag(@Param('id', ParseIntPipe) id: number) {
    await this.tagService.delete(id);
  }

  // Custom Fields
  @Get('custom-fields')
  async listCustomFields(@Query('entityType') entityType?: string) {
    return this.customFieldService.findAll(entityType);
  }

  @Post('custom-fields')
  @AuditAction('create', 'custom_field')
  async createCustomField(@Body() body: any) {
    return this.customFieldService.create(body);
  }

  @Put('custom-fields/:id')
  @AuditAction('update', 'custom_field')
  async updateCustomField(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.customFieldService.update(id, body);
  }

  @Delete('custom-fields/:id')
  @HttpCode(204)
  async deleteCustomField(@Param('id', ParseIntPipe) id: number) {
    await this.customFieldService.delete(id);
  }

  // Roles
  @Get('roles')
  async listRoles() {
    return this.roleService.findAll();
  }

  @Get('permissions')
  async listPermissions() {
    return this.roleService.getAllPermissions();
  }

  @Post('roles')
  @AuditAction('create', 'role')
  async createRole(@Body() body: any) {
    return this.roleService.create(body);
  }

  @Put('roles/:id')
  @AuditAction('update', 'role')
  async updateRole(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.roleService.update(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  async deleteRole(@Param('id', ParseIntPipe) id: number) {
    await this.roleService.delete(id);
  }

  // Audit Logs
  @Get('audit-logs')
  async listAuditLogs(@Query() filters: any) {
    return this.auditLogService.findAll(filters);
  }
}
