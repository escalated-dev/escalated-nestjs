import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { AgentCapacity } from '../../entities/agent-capacity.entity';
import { AgentProfile } from '../../entities/agent-profile.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { BusinessSchedule } from '../../entities/business-schedule.entity';
import { Holiday } from '../../entities/holiday.entity';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { BusinessScheduleService } from '../../services/business-schedule.service';
import {
  AUDIT_ACTIONS,
  businessScheduleInput,
  capacityInput,
  serializeAuditLog,
  serializeBusinessSchedule,
  serializeCapacity,
  storedAuditActions,
  timezones,
} from '../admin-operations';
import { back, inertia, redirect } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard } from '../inertia.interceptor';
import { routeUrl } from '../routes';
import { paginate } from '../serializers';
import { UiDataService } from '../ui-data.service';

const AUDIT_FILTERS = ['user_id', 'action', 'auditable_type', 'date_from', 'date_to'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * The admin operations screens with no JSON route of the same path
 * (registered with `ui.enabled`): business hours
 * (`/escalated/admin/business-hours`), agent capacity
 * (`/escalated/admin/capacity`) and the audit log
 * (`/escalated/admin/audit-log`), as escalated-laravel's
 * BusinessHoursController, CapacityController and AuditLogController serve
 * them. Automations and skills are served by their JSON admin routes.
 */
@UseGuards(EscalatedAdminGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/admin')
export class AdminOperationsUiController {
  constructor(
    private readonly schedules: BusinessScheduleService,
    private readonly data: UiDataService,
    @InjectRepository(BusinessSchedule)
    private readonly scheduleRows: Repository<BusinessSchedule>,
    @InjectRepository(Holiday) private readonly holidays: Repository<Holiday>,
    @InjectRepository(AgentCapacity) private readonly capacities: Repository<AgentCapacity>,
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
  ) {}

  // Business hours

  private toSchedules(message: string) {
    return redirect(routeUrl('escalated.admin.business-hours.index'), { success: message });
  }

  /** Makes this the only default schedule when it is marked default. */
  private async soleDefault(schedule: BusinessSchedule) {
    if (schedule.isDefault) {
      await this.scheduleRows.update(
        { id: Not(schedule.id), isDefault: true },
        { isDefault: false },
      );
    }
  }

  private async replaceHolidays(
    scheduleId: number,
    holidays: Array<{ name: string; date: string; isRecurring: boolean }>,
  ) {
    await this.holidays.delete({ businessScheduleId: scheduleId });
    if (holidays.length) {
      await this.holidays.save(
        holidays.map((holiday) =>
          this.holidays.create({ ...holiday, businessScheduleId: scheduleId }),
        ),
      );
    }
  }

  @Get('business-hours')
  async scheduleIndex() {
    const rows = await this.scheduleRows.find({
      relations: { holidays: true },
      order: { id: 'ASC' },
    });
    return inertia('Escalated/Admin/BusinessHours/Index', {
      schedules: rows.map(serializeBusinessSchedule),
    });
  }

  @Get('business-hours/create')
  scheduleCreate() {
    return inertia('Escalated/Admin/BusinessHours/Form', {
      schedule: null,
      timezones: timezones(),
    });
  }

  @Post('business-hours')
  async scheduleStore(@Body() body: any) {
    const { holidays, ...input } = businessScheduleInput(body);
    const schedule = await this.schedules.create(input);
    await this.soleDefault(schedule);
    await this.replaceHolidays(schedule.id, holidays);
    return this.toSchedules('Business schedule created.');
  }

  @Get('business-hours/:id/edit')
  async scheduleEdit(@Param('id', ParseIntPipe) id: number) {
    return inertia('Escalated/Admin/BusinessHours/Form', {
      schedule: serializeBusinessSchedule(await this.schedules.findById(id)),
      timezones: timezones(),
    });
  }

  @Put('business-hours/:id')
  async scheduleUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    await this.schedules.findById(id);
    const { holidays, ...input } = businessScheduleInput(body);
    const schedule = await this.schedules.update(id, input);
    await this.soleDefault(schedule);
    await this.replaceHolidays(id, holidays);
    return this.toSchedules('Business schedule updated.');
  }

  /** Clears the schedule from the SLA policies and departments that used it. */
  @Delete('business-hours/:id')
  async scheduleDestroy(@Param('id', ParseIntPipe) id: number) {
    await this.schedules.delete(id);
    return this.toSchedules('Business schedule deleted.');
  }

  // Capacity

  @Get('capacity')
  async capacityIndex() {
    const rows = await this.capacities.find({ order: { agentProfileId: 'ASC', id: 'ASC' } });
    const profiles = rows.length
      ? await this.profiles.find({ where: { id: In(rows.map((row) => row.agentProfileId)) } })
      : [];
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const directory = await this.data.directory(profiles.map((profile) => profile.userId));
    return inertia('Escalated/Admin/Capacity/Index', {
      capacities: rows.map((row) => {
        const profile = byId.get(row.agentProfileId);
        const user = profile ? directory.get(String(profile.userId)) : undefined;
        return serializeCapacity(
          row,
          profile?.userId ?? null,
          profile?.displayName || user?.name || null,
        );
      }),
    });
  }

  @Put('capacity/:id')
  async capacityUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const capacity = await this.capacities.findOne({ where: { id } });
    if (!capacity) throw new NotFoundException('Capacity not found');
    await this.capacities.update(id, { maxTickets: capacityInput(body) });
    return back(routeUrl('escalated.admin.capacity.index'), { success: 'Capacity updated.' });
  }

  // Audit log

  @Get('audit-log')
  async auditLog(@Query() query: Record<string, unknown>) {
    const filters: Record<string, string> = {};
    for (const key of AUDIT_FILTERS) {
      const value = query?.[key];
      if (typeof value === 'string' && value !== '') filters[key] = value;
    }

    const qb = this.logs.createQueryBuilder('log');
    if (filters.user_id) qb.andWhere('log.userId = :userId', { userId: filters.user_id });
    if (filters.action) {
      qb.andWhere('log.action IN (:...actions)', { actions: storedAuditActions(filters.action) });
    }
    if (filters.auditable_type) {
      qb.andWhere('log.entityType = :type', { type: filters.auditable_type });
    }
    if (filters.date_from && DATE.test(filters.date_from)) {
      qb.andWhere('log.createdAt >= :from', { from: new Date(`${filters.date_from}T00:00:00Z`) });
    }
    if (filters.date_to && DATE.test(filters.date_to)) {
      qb.andWhere('log.createdAt <= :to', { to: new Date(`${filters.date_to}T23:59:59.999Z`) });
    }

    const perPage = 50;
    const current = positiveInt(query?.page, 1);
    const [rows, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((current - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    const [userIds, types] = await Promise.all([
      this.logs
        .createQueryBuilder('log')
        .select('DISTINCT log.userId', 'userId')
        .where('log.userId IS NOT NULL')
        .getRawMany(),
      this.logs
        .createQueryBuilder('log')
        .select('DISTINCT log.entityType', 'type')
        .orderBy('log.entityType', 'ASC')
        .getRawMany(),
    ]);
    const ids = [...rows.map((row) => row.userId), ...userIds.map((row) => row.userId)];
    const directory = await this.data.directory(ids);
    const users = userIds
      .map((row) => {
        const known = directory.get(String(row.userId));
        return { id: row.userId, name: known?.name ?? `User #${row.userId}` };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return inertia('Escalated/Admin/AuditLog/Index', {
      logs: paginate(
        rows.map((row) => serializeAuditLog(row, directory)),
        total,
        current,
        perPage,
        routeUrl('escalated.admin.audit-log'),
        filters,
      ),
      filters,
      users,
      actions: AUDIT_ACTIONS,
      resourceTypes: types.map((row) => row.type),
    });
  }
}
