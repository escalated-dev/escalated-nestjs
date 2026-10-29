import { RequiresAccessFeature } from '../../access/access-feature.guard';
import { accessFeatureEnabled } from '../../access/access-features';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import {
  Body,
  Inject,
  Optional,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessSchedule } from '../../entities/business-schedule.entity';
import { Department } from '../../entities/department.entity';
import { Tag } from '../../entities/tag.entity';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { DepartmentService } from '../../services/department.service';
import { SettingsService } from '../../services/settings.service';
import { invalidOriginEntries } from '../../services/widget-origins.service';
import { scheduleOptions, scheduleReference } from '../admin-config';
import { userRoleInput } from '../admin-people';
import { back, inertia } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { routeUrl } from '../routes';
import { UiDataService } from '../ui-data.service';

type SettingKind = 'boolean' | 'string';

/**
 * The settings this backend stores and reads, so the shared Settings page
 * shows only these controls (`supported_settings`), as escalated-laravel's
 * Admin\SettingsController sends exactly the keys it saves.
 */
export const SUPPORTED_SETTINGS: Record<string, { kind: SettingKind; fallback: unknown }> = {
  show_powered_by: { kind: 'boolean', fallback: true },
  widget_color: { kind: 'string', fallback: '#4F46E5' },
  widget_position: { kind: 'string', fallback: 'bottom-right' },
  widget_greeting: { kind: 'string', fallback: 'Hi there! How can we help?' },
  widget_allowed_origins: { kind: 'string', fallback: '' },
  // Takes effect only while access.twoFactor is on (ADR 2026-10-29).
  two_factor_required: { kind: 'boolean', fallback: false },
};

/**
 * The settings this install offers: `two_factor_required` only while the
 * two-factor switch is on, since it does nothing otherwise.
 */
export function supportedSettings(
  options: EscalatedModuleOptions | null | undefined,
): Record<string, { kind: SettingKind; fallback: unknown }> {
  const all = { ...SUPPORTED_SETTINGS };
  if (!accessFeatureEnabled(options, 'two_factor')) delete all.two_factor_required;
  return all;
}

function boolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return null;
}

/** Form fields of the department form, in the entity's names. */
export function departmentInput(body: any): Partial<Department> {
  const name = body?.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new UiValidationException({ name: 'The name field is required.' });
  }
  if (name.length > 255) {
    throw new UiValidationException({ name: 'The name may not be greater than 255 characters.' });
  }
  const slug = typeof body?.slug === 'string' && body.slug.trim() ? body.slug.trim() : undefined;
  if (slug && !/^[a-z0-9-]+$/.test(slug)) {
    throw new UiValidationException({
      slug: 'The slug may only contain lowercase letters, numbers and dashes.',
    });
  }
  const isActive = body?.is_active == null ? true : boolean(body.is_active);
  if (isActive === null) {
    throw new UiValidationException({ is_active: 'The is active field must be true or false.' });
  }
  const businessScheduleId = scheduleReference(body);
  return {
    name: name.trim(),
    ...(slug ? { slug } : {}),
    description: typeof body?.description === 'string' ? body.description : null,
    isActive,
    ...(businessScheduleId !== undefined ? { businessScheduleId } : {}),
  } as Partial<Department>;
}

/** Form fields of the tag form, in the entity's names. */
export function tagInput(body: any): Partial<Tag> {
  const name = body?.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 255) {
    throw new UiValidationException({ name: 'The name field is required.' });
  }
  const color = body?.color;
  if (color != null && color !== '' && !/^#[0-9A-Fa-f]{6}$/.test(String(color))) {
    throw new UiValidationException({ color: 'The color must be a hex colour like #06b6d4.' });
  }
  return { name: name.trim(), ...(color ? { color: String(color) } : {}) };
}

/**
 * The admin screens' own routes (registered with `ui.enabled`): saving the
 * settings form, the department and role create/edit forms, and the users
 * screen (host users through `ui.listUsers` / `ui.updateUserRoles`). The list pages and
 * the department/tag/workflow writes are served by the JSON admin routes,
 * which answer screens with redirects.
 */
@UseGuards(EscalatedAdminGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/admin')
export class AdminUiController {
  constructor(
    private readonly settings: SettingsService,
    private readonly departments: DepartmentService,
    private readonly data: UiDataService,
    @InjectRepository(BusinessSchedule) private readonly schedules: Repository<BusinessSchedule>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  @Post('settings')
  @HttpCode(200)
  async updateSettings(@Body() body: any) {
    const errors: Record<string, string> = {};
    const writes: Array<[string, string, SettingKind]> = [];

    for (const [key, { kind }] of Object.entries(supportedSettings(this.options))) {
      if (body?.[key] === undefined) continue;
      const value = body[key];
      if (kind === 'boolean') {
        const flag = boolean(value);
        if (flag === null)
          errors[key] = `The ${key.replace(/_/g, ' ')} field must be true or false.`;
        else writes.push([key, String(flag), 'boolean']);
        continue;
      }
      const text = value == null ? '' : String(value);
      if (key === 'widget_color' && !/^#[0-9A-Fa-f]{6}$/.test(text)) {
        errors[key] = 'The widget color must be a hex colour like #4F46E5.';
      } else if (key === 'widget_position' && !['bottom-right', 'bottom-left'].includes(text)) {
        errors[key] = 'The selected widget position is invalid.';
      } else if (key === 'widget_greeting' && text.length > 255) {
        errors[key] = 'The widget greeting may not be greater than 255 characters.';
      } else if (key === 'widget_allowed_origins') {
        const invalid = invalidOriginEntries(text);
        if (text.length > 5000 || invalid.length) {
          errors[key] = `Not a valid origin: ${invalid.join(', ') || 'too long'}.`;
        } else {
          writes.push([
            key,
            text
              .split(/[\s,]+/)
              .filter(Boolean)
              .join('\n'),
            'string',
          ]);
        }
        continue;
      }
      if (!errors[key]) writes.push([key, text, 'string']);
    }

    if (Object.keys(errors).length) throw new UiValidationException(errors);
    for (const [key, value, type] of writes) await this.settings.set(key, value, type);
    return back(routeUrl('escalated.admin.settings'), { success: 'Settings updated.' });
  }

  @Get('departments/create')
  async create() {
    return inertia('Escalated/Admin/Departments/Form', {
      department: null,
      schedules: await scheduleOptions(this.schedules),
    });
  }

  @Get('departments/:id/edit')
  async edit(@Param('id', ParseIntPipe) id: number) {
    const department = await this.departments.findById(id);
    return inertia('Escalated/Admin/Departments/Form', {
      department: this.data.serializeDepartment(department),
      schedules: await scheduleOptions(this.schedules),
    });
  }

  @RequiresAccessFeature('roles_permissions')
  @Get('roles/create')
  async createRole() {
    return inertia('Escalated/Admin/Roles/Form', {
      role: null,
      permissions: await this.data.groupedPermissions(),
    });
  }

  @RequiresAccessFeature('roles_permissions')
  @Get('roles/:id/edit')
  async editRole(@Param('id', ParseIntPipe) id: number) {
    return inertia('Escalated/Admin/Roles/Form', {
      role: await this.data.role(id),
      permissions: await this.data.groupedPermissions(),
    });
  }

  /**
   * `Escalated/Admin/Users/Index`, as escalated-laravel's
   * Admin\UserController: host users from `ui.listUsers`, 20 a page,
   * searchable by name or email. Without the hook the page renders empty with
   * a `notice`.
   */
  @Get('users')
  async users(@Query('search') search: unknown, @Query('page') page: unknown, @Req() req: any) {
    const term = typeof search === 'string' ? search.trim() : '';
    const { users, notice } = await this.data.adminUsers(
      term,
      page,
      routeUrl('escalated.admin.users.index'),
    );
    return inertia('Escalated/Admin/Users/Index', {
      users,
      filters: { search: term },
      currentUserId: req.user?.id ?? null,
      notice,
    });
  }

  /**
   * The users screen's admin/agent toggles (`role`: admin|agent, `value`).
   * An admin cannot remove their own admin access.
   */
  @Patch('users/:user/role')
  async updateUserRole(@Param('user') user: string, @Body() body: any, @Req() req: any) {
    const { role, value } = userRoleInput(body);
    const index = routeUrl('escalated.admin.users.index');
    if (!this.data.canUpdateUserRoles()) {
      return back(index, {
        error:
          'Escalated cannot change user access here: the host application has not provided ui.updateUserRoles.',
      });
    }
    const self = req.user?.id != null && String(req.user.id) === String(user);
    if (role === 'admin' && !value && self) {
      return back(index, { error: 'You cannot remove your own admin role.' });
    }
    if (!(await this.data.updateUserRole(user, role, value))) {
      throw new NotFoundException('User not found');
    }
    return back(index, { success: 'User updated.' });
  }
}
