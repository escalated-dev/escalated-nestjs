import { RequiresAccessFeature } from '../../access/access-feature.guard';
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
  Inject,
  Optional,
  Req,
} from '@nestjs/common';
import { SettingsService } from '../../services/settings.service';
import { DepartmentService } from '../../services/department.service';
import { TagService } from '../../services/tag.service';
import { RoleService } from '../../services/role.service';
import { AuditLogService } from '../../services/audit-log.service';
import {
  WIDGET_ALLOWED_ORIGINS_SETTING,
  invalidOriginEntries,
} from '../../services/widget-origins.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { back, inertia, redirect } from '../../ui/inertia';
import { EscalatedUi, BrowserFormGuard, UiValidationException } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { UiDataService } from '../../ui/ui-data.service';
import { roleInput } from '../../ui/admin-people';
import {
  supportedSettings,
  departmentInput,
  tagInput,
} from '../../ui/controllers/admin-ui.controller';

/**
 * Admin settings, departments, tags and more as a JSON API. With
 * `ui.enabled`, the settings, department and tag routes also serve the admin
 * screens and answer the screens' forms with redirects.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminSettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly departmentService: DepartmentService,
    private readonly tagService: TagService,
    private readonly roleService: RoleService,
    private readonly auditLogService: AuditLogService,
    @Optional() private readonly ui?: UiDataService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return !!this.ui && wantsPage(this.options, req);
  }

  // Settings
  @Get('settings')
  async listSettings(@Query('group') group?: string, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      const settings: Record<string, unknown> = {};
      const supported = supportedSettings(this.options);
      for (const [key, { fallback }] of Object.entries(supported)) {
        settings[key] = await this.settingsService.getTyped(key, fallback);
      }
      return inertia('Escalated/Admin/Settings', {
        settings,
        supported_settings: Object.keys(supported),
        departments: await this.ui!.departmentOptions(),
        update_url: routeUrl('escalated.admin.settings.update'),
      });
    }
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
  async listDepartments(@Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Departments/Index', {
        departments: await this.ui!.departmentsWithCounts(),
      });
    }
    return this.departmentService.findAll();
  }

  /** The department form's fields, refusing a business schedule that does not exist. */
  private async departmentFormInput(body: any) {
    const input = departmentInput(body);
    if (
      input.businessScheduleId != null &&
      !(await this.departmentService.scheduleExists(input.businessScheduleId))
    ) {
      throw new UiValidationException({
        business_schedule_id: 'The selected business schedule is invalid.',
      });
    }
    return input;
  }

  @Post('departments')
  @AuditAction('create', 'department')
  async createDepartment(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      await this.departmentService.create(await this.departmentFormInput(body));
      return redirect(routeUrl('escalated.admin.departments.index'), {
        success: 'Department created.',
      });
    }
    return this.departmentService.create(body);
  }

  @Put('departments/:id')
  @AuditAction('update', 'department')
  async updateDepartment(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      await this.departmentService.update(id, await this.departmentFormInput(body));
      return redirect(routeUrl('escalated.admin.departments.index'), {
        success: 'Department updated.',
      });
    }
    return this.departmentService.update(id, body);
  }

  @Delete('departments/:id')
  @HttpCode(204)
  async deleteDepartment(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.departmentService.delete(id);
    if (this.screen(req)) {
      return redirect(routeUrl('escalated.admin.departments.index'), {
        success: 'Department deleted.',
      });
    }
  }

  // Tags
  @Get('tags')
  async listTags(@Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Tags/Index', { tags: await this.ui!.tagsWithCounts() });
    }
    return this.tagService.findAll();
  }

  @Post('tags')
  @AuditAction('create', 'tag')
  async createTag(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      await this.tagService.create(tagInput(body));
      return back(routeUrl('escalated.admin.tags.index'), { success: 'Tag created.' });
    }
    return this.tagService.create(body);
  }

  @Put('tags/:id')
  async updateTag(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      await this.tagService.update(id, tagInput(body));
      return back(routeUrl('escalated.admin.tags.index'), { success: 'Tag updated.' });
    }
    return this.tagService.update(id, body);
  }

  @Delete('tags/:id')
  @HttpCode(204)
  async deleteTag(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.tagService.delete(id);
    if (this.screen(req)) {
      return back(routeUrl('escalated.admin.tags.index'), { success: 'Tag deleted.' });
    }
  }

  // Roles
  @RequiresAccessFeature('roles_permissions')
  @Get('roles')
  async listRoles(@Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Roles/Index', { roles: await this.ui!.adminRoles() });
    }
    return this.roleService.findAll();
  }

  @RequiresAccessFeature('roles_permissions')
  @Get('permissions')
  async listPermissions() {
    return this.roleService.getAllPermissions();
  }

  @RequiresAccessFeature('roles_permissions')
  @Post('roles')
  @AuditAction('create', 'role')
  async createRole(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      const input = roleInput(body);
      await this.roleService.create({ ...input, slug: await this.ui!.uniqueRoleSlug(input.name) });
      return redirect(routeUrl('escalated.admin.roles.index'), { success: 'Role created.' });
    }
    return this.roleService.create(body);
  }

  @RequiresAccessFeature('roles_permissions')
  @Put('roles/:id')
  @AuditAction('update', 'role')
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      const input = roleInput(body);
      await this.roleService.update(id, {
        ...input,
        description: input.description ?? (null as unknown as string),
        permissionIds: input.permissionIds ?? [],
      });
      return redirect(routeUrl('escalated.admin.roles.index'), { success: 'Role updated.' });
    }
    return this.roleService.update(id, body);
  }

  @RequiresAccessFeature('roles_permissions')
  @Delete('roles/:id')
  @HttpCode(204)
  async deleteRole(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.roleService.delete(id);
    if (this.screen(req)) {
      return redirect(routeUrl('escalated.admin.roles.index'), { success: 'Role deleted.' });
    }
  }

  // Audit Logs
  @Get('audit-logs')
  async listAuditLogs(@Query() filters: any) {
    return this.auditLogService.findAll(filters);
  }
}
