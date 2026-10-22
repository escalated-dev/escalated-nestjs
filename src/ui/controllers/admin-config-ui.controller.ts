import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { BusinessSchedule } from '../../entities/business-schedule.entity';
import { SlaPolicy } from '../../entities/sla-policy.entity';
import { Ticket } from '../../entities/ticket.entity';
import { TicketStatus } from '../../entities/ticket-status.entity';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { EscalationService } from '../../services/escalation.service';
import { SlaService } from '../../services/sla.service';
import { WebhookService } from '../../services/webhook.service';
import {
  escalationRuleInput,
  serializeEscalationRule,
  serializeSlaPolicy,
  serializeStatus,
  SLA_PRIORITIES,
  scheduleReference,
  slaPolicyInput,
  slugify,
  STATUS_CATEGORIES,
  statusInput,
} from '../admin-config';
import { back, inertia, redirect } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { routeUrl } from '../routes';

/**
 * The admin configuration screens with no JSON route of the same path
 * (registered with `ui.enabled`): SLA policies (`/escalated/admin/sla-policies`)
 * ticket statuses (`/escalated/admin/statuses`) and escalation rules
 * (`/escalated/admin/escalation-rules`), as escalated-laravel's
 * SlaPolicyController, StatusController and EscalationRuleController serve
 * them, and the webhook
 * delivery retry. Macros, canned responses and webhooks are served by their
 * JSON admin routes, which answer the screens.
 */
@UseGuards(EscalatedAdminGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/admin')
export class AdminConfigUiController {
  constructor(
    private readonly sla: SlaService,
    private readonly webhooks: WebhookService,
    private readonly escalations: EscalationService,
    @InjectRepository(SlaPolicy) private readonly policies: Repository<SlaPolicy>,
    @InjectRepository(BusinessSchedule) private readonly schedules: Repository<BusinessSchedule>,
    @InjectRepository(TicketStatus) private readonly statuses: Repository<TicketStatus>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
  ) {}

  // SLA policies

  private async defaultScheduleId(): Promise<number | null> {
    const schedule = await this.schedules.findOne({
      where: {},
      order: { isDefault: 'DESC', id: 'ASC' },
    });
    return schedule?.id ?? null;
  }

  /** Refuses a `business_schedule_id` that names no schedule. */
  private async checkScheduleReference(body: any) {
    const id = scheduleReference(body);
    if (id != null && !(await this.schedules.exists({ where: { id } }))) {
      throw new UiValidationException({
        business_schedule_id: 'The selected business schedule is invalid.',
      });
    }
  }

  /** Makes this the only default policy when it is marked default. */
  private async soleDefault(policy: SlaPolicy) {
    if (policy.isDefault) {
      await this.policies.update({ id: Not(policy.id), isDefault: true }, { isDefault: false });
    }
  }

  private toPolicies(message: string) {
    return redirect(routeUrl('escalated.admin.sla-policies.index'), { success: message });
  }

  private form(policy: SlaPolicy | null) {
    return inertia('Escalated/Admin/SlaPolicies/Form', {
      policy: policy ? serializeSlaPolicy(policy) : null,
      priorities: [...SLA_PRIORITIES],
    });
  }

  @Get('sla-policies')
  async slaIndex() {
    const [rows, counts] = await Promise.all([
      this.policies.find({ order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.tickets
        .createQueryBuilder('ticket')
        .select('ticket.slaPolicyId', 'id')
        .addSelect('COUNT(ticket.id)', 'count')
        .where('ticket.slaPolicyId IS NOT NULL')
        .groupBy('ticket.slaPolicyId')
        .getRawMany(),
    ]);
    const byPolicy = new Map(counts.map((row) => [Number(row.id), Number(row.count)]));
    return inertia('Escalated/Admin/SlaPolicies/Index', {
      policies: rows.map((policy) => serializeSlaPolicy(policy, byPolicy.get(policy.id) ?? 0)),
    });
  }

  @Get('sla-policies/create')
  slaCreate() {
    return this.form(null);
  }

  @Post('sla-policies')
  async slaStore(@Body() body: any) {
    await this.checkScheduleReference(body);
    const policy = await this.sla.create(
      slaPolicyInput(body, null, body?.business_hours_only ? await this.defaultScheduleId() : null),
    );
    await this.soleDefault(policy);
    return this.toPolicies('SLA policy created.');
  }

  @Get('sla-policies/:id/edit')
  async slaEdit(@Param('id', ParseIntPipe) id: number) {
    return this.form(await this.sla.findById(id));
  }

  @Put('sla-policies/:id')
  async slaUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const existing = await this.sla.findById(id);
    await this.checkScheduleReference(body);
    const input = slaPolicyInput(
      body,
      existing,
      body?.business_hours_only ? await this.defaultScheduleId() : null,
    );
    const policy = await this.sla.update(id, input);
    await this.soleDefault(policy);
    return this.toPolicies('SLA policy updated.');
  }

  @Delete('sla-policies/:id')
  async slaDestroy(@Param('id', ParseIntPipe) id: number) {
    await this.sla.delete(id);
    return this.toPolicies('SLA policy deleted.');
  }

  // Statuses

  private toStatuses(message: string) {
    return redirect(routeUrl('escalated.admin.statuses.index'), { success: message });
  }

  private async findStatus(id: number): Promise<TicketStatus> {
    const status = await this.statuses.findOne({ where: { id } });
    if (!status) throw new NotFoundException('Status not found');
    return status;
  }

  /** A unique slug for a new status's label. */
  private async slugFor(label: string): Promise<string> {
    const base = slugify(label) || 'status';
    let slug = base;
    for (let n = 2; await this.statuses.existsBy({ slug }); n += 1) slug = `${base}_${n}`;
    return slug;
  }

  /** The default status is the one new tickets get: only one may be. */
  private async soleDefaultStatus(status: TicketStatus) {
    if (status.isDefault) {
      await this.statuses.update({ id: Not(status.id), isDefault: true }, { isDefault: false });
    }
  }

  @Get('statuses')
  async statusIndex() {
    const rows = await this.statuses.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    return inertia('Escalated/Admin/Statuses/Index', {
      statuses: rows.map(serializeStatus),
      categories: STATUS_CATEGORIES,
    });
  }

  @Get('statuses/create')
  statusCreate() {
    return inertia('Escalated/Admin/Statuses/Form', {
      status: null,
      categories: STATUS_CATEGORIES,
    });
  }

  @Post('statuses')
  async statusStore(@Body() body: any) {
    const input = statusInput(body);
    const status = await this.statuses.save(
      this.statuses.create({ ...input, slug: await this.slugFor(input.name!) }),
    );
    await this.soleDefaultStatus(status);
    return this.toStatuses('Status created.');
  }

  @Get('statuses/:id/edit')
  async statusEdit(@Param('id', ParseIntPipe) id: number) {
    return inertia('Escalated/Admin/Statuses/Form', {
      status: serializeStatus(await this.findStatus(id)),
      categories: STATUS_CATEGORIES,
    });
  }

  /** Keeps the slug: tickets, filters and macros refer to a status by it. */
  @Put('statuses/:id')
  async statusUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    const status = await this.findStatus(id);
    Object.assign(status, statusInput(body));
    await this.soleDefaultStatus(await this.statuses.save(status));
    return this.toStatuses('Status updated.');
  }

  @Delete('statuses/:id')
  async statusDestroy(@Param('id', ParseIntPipe) id: number) {
    const status = await this.findStatus(id);
    const inUse = await this.tickets.countBy({ statusId: status.id });
    if (inUse) {
      throw new ConflictException(
        `${inUse} ticket(s) have this status; move them to another status first.`,
      );
    }
    await this.statuses.remove(status);
    return this.toStatuses('Status deleted.');
  }

  // Escalation rules

  private toRules(message: string) {
    return redirect(routeUrl('escalated.admin.escalation-rules.index'), { success: message });
  }

  @Get('escalation-rules')
  async ruleIndex() {
    const rules = await this.escalations.findAll();
    return inertia('Escalated/Admin/EscalationRules/Index', {
      rules: rules.map(serializeEscalationRule),
    });
  }

  @Get('escalation-rules/create')
  ruleCreate() {
    return inertia('Escalated/Admin/EscalationRules/Form', { rule: null });
  }

  @Post('escalation-rules')
  async ruleStore(@Body() body: any) {
    await this.escalations.create(escalationRuleInput(body));
    return this.toRules('Escalation rule created.');
  }

  @Get('escalation-rules/:id/edit')
  async ruleEdit(@Param('id', ParseIntPipe) id: number) {
    return inertia('Escalated/Admin/EscalationRules/Form', {
      rule: serializeEscalationRule(await this.escalations.findById(id)),
    });
  }

  @Put('escalation-rules/:id')
  async ruleUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    await this.escalations.update(id, escalationRuleInput(body));
    return this.toRules('Escalation rule updated.');
  }

  @Delete('escalation-rules/:id')
  async ruleDestroy(@Param('id', ParseIntPipe) id: number) {
    await this.escalations.delete(id);
    return this.toRules('Escalation rule deleted.');
  }

  // Webhooks

  @Post('webhooks/deliveries/:delivery/retry')
  @HttpCode(200)
  async retryDelivery(@Param('delivery', ParseIntPipe) id: number) {
    const delivery = await this.webhooks.retryDelivery(id);
    return back(routeUrl('escalated.admin.webhooks.deliveries', { webhook: delivery.webhookId }), {
      success: 'Webhook delivery retried.',
    });
  }
}
