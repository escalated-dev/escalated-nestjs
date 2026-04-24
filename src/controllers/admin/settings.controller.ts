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

  // --- Public-ticket guest policy ---
  //
  // Dedicated endpoint that matches the shape shipped by all 10 host-framework
  // plugins (Laravel/Rails/Django/Adonis/WordPress/Symfony/.NET/Go/Spring/Phoenix).
  // Internally it writes a single `guest_policy` JSON blob so the widget
  // controller's existing `settingsService.getTyped('guest_policy')` lookup
  // continues to work with zero change.
  //
  // Validation semantics mirror the host-framework ports:
  //   - Unknown mode → coerced to 'unassigned' (never 500s on bad input)
  //   - Mode switch clears mode-specific fields (stale guestUserId can't leak
  //     into prompt_signup behavior)
  //   - Zero / negative user id surfaces as JSON null on GET
  //   - Signup URL templates trimmed + truncated to 500 chars
  //
  // Wire format is snake_case to match what the shared
  // Admin/Settings/PublicTickets.vue page sends.

  @Get('settings/public-tickets')
  async getPublicTicketsSettings() {
    return this.loadPublicTicketsPayload();
  }

  @Put('settings/public-tickets')
  @AuditAction('update', 'settings')
  async updatePublicTicketsSettings(
    @Body() body: {
      guest_policy_mode?: string;
      guest_policy_user_id?: number | null;
      guest_policy_signup_url_template?: string | null;
    },
  ) {
    const validModes = new Set(['unassigned', 'guest_user', 'prompt_signup']);
    const mode = validModes.has(body.guest_policy_mode ?? '')
      ? (body.guest_policy_mode as string)
      : 'unassigned';

    const stored: Record<string, unknown> = { mode };

    if (mode === 'guest_user') {
      const userId = Number(body.guest_policy_user_id);
      if (Number.isFinite(userId) && userId > 0) {
        stored.guestUserId = userId;
      }
    }

    if (mode === 'prompt_signup') {
      const raw = (body.guest_policy_signup_url_template ?? '').trim();
      if (raw) {
        stored.signupUrlTemplate = raw.length > 500 ? raw.slice(0, 500) : raw;
      }
    }

    await this.settingsService.set('guest_policy', stored, 'json', 'public_tickets');
    return this.loadPublicTicketsPayload();
  }

  private async loadPublicTicketsPayload() {
    const stored = await this.settingsService.getTyped<Record<string, unknown> | null>(
      'guest_policy',
      null,
    );

    const mode = typeof stored?.mode === 'string' ? stored.mode : 'unassigned';
    const userId = typeof stored?.guestUserId === 'number' && stored.guestUserId > 0
      ? stored.guestUserId
      : null;
    const template =
      typeof stored?.signupUrlTemplate === 'string' ? stored.signupUrlTemplate : '';

    return {
      guest_policy_mode: mode,
      guest_policy_user_id: userId,
      guest_policy_signup_url_template: template,
    };
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
