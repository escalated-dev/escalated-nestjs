import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  UseInterceptors,
} from '@nestjs/common';
import { SettingsService } from '../../services/settings.service';
import { DepartmentService } from '../../services/department.service';
import { TagService } from '../../services/tag.service';
import { CustomFieldService } from '../../services/custom-field.service';
import { RoleService } from '../../services/role.service';
import { AuditLogService } from '../../services/audit-log.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

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
    await this.settingsService.setMany(body);
    return { success: true };
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
