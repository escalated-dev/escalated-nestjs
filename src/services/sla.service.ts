import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TicketAccess } from '../config/ticket-access';
import { Repository, LessThan, IsNull, Between } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaPolicy } from '../entities/sla-policy.entity';
import { BusinessSchedule } from '../entities/business-schedule.entity';
import { Ticket } from '../entities/ticket.entity';
import { Department } from '../entities/department.entity';
import { addBusinessMinutes, countsBusinessHours } from './business-hours';
import { ESCALATED_EVENTS, SlaBreachedEvent, SlaWarningEvent } from '../events/escalated.events';

@Injectable()
export class SlaService {
  constructor(
    @InjectRepository(SlaPolicy)
    private readonly slaPolicyRepo: Repository<SlaPolicy>,
    @InjectRepository(BusinessSchedule)
    private readonly scheduleRepo: Repository<BusinessSchedule>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly access?: TicketAccess,
  ) {}

  async findAll(): Promise<SlaPolicy[]> {
    return this.slaPolicyRepo.find({
      order: { sortOrder: 'ASC' },
      relations: { escalationRules: true },
    });
  }

  async findById(id: number): Promise<SlaPolicy> {
    const policy = await this.slaPolicyRepo.findOne({
      where: { id },
      relations: { escalationRules: true },
    });
    if (!policy) throw new NotFoundException(`SLA Policy #${id} not found`);
    return policy;
  }

  async create(data: Partial<SlaPolicy>): Promise<SlaPolicy> {
    const policy = this.slaPolicyRepo.create(data);
    return this.slaPolicyRepo.save(policy);
  }

  async update(id: number, data: Partial<SlaPolicy>): Promise<SlaPolicy> {
    await this.findById(id);
    await this.slaPolicyRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const policy = await this.findById(id);
    await this.slaPolicyRepo.remove(policy);
  }

  async applyToTicket(ticket: Ticket): Promise<void> {
    // Find matching SLA policy
    const policy = await this.findMatchingPolicy(ticket);
    if (!policy) return;

    const firstResponseMinutes = this.getFirstResponseMinutes(policy, ticket.priority);
    const resolutionMinutes = this.getResolutionMinutes(policy, ticket.priority);

    const now = this.access?.options.targetedSlas ? new Date(ticket.createdAt) : new Date();
    const schedule = countsBusinessHours(policy) ? await this.scheduleFor(policy, ticket) : null;
    const due = (minutes: number) =>
      schedule
        ? this.addBusinessMinutes(now, minutes, schedule)
        : new Date(now.getTime() + minutes * 60000);
    const firstResponseDue = due(firstResponseMinutes);
    const resolutionDue = due(resolutionMinutes);

    Object.assign(ticket, {
      slaPolicyId: policy.id,
      firstResponseDueAt: firstResponseDue,
      resolutionDueAt: resolutionDue,
    });
    await this.ticketRepo.update(ticket.id, {
      slaPolicyId: policy.id,
      firstResponseDueAt: firstResponseDue,
      resolutionDueAt: resolutionDue,
    });
  }

  /**
   * Records each missed deadline once and emits `sla.breached` once for it,
   * like Laravel's per-type breach flags. Tickets already flagged are skipped
   * on later ticks, so webhooks and listeners do not fire every minute.
   */
  async checkBreaches(): Promise<void> {
    const now = new Date();

    const firstResponseBreaches = await this.ticketRepo.find({
      where: {
        firstResponseDueAt: LessThan(now),
        firstRespondedAt: IsNull(),
        slaFirstResponseBreached: false,
        isMerged: false,
      },
    });

    for (const ticket of firstResponseBreaches) {
      if (!(await this.flagBreach(ticket, 'slaFirstResponseBreached'))) continue;
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SLA_BREACHED,
        new SlaBreachedEvent(ticket, 'first_response'),
      );
    }

    const resolutionBreaches = await this.ticketRepo.find({
      where: {
        resolutionDueAt: LessThan(now),
        resolvedAt: IsNull(),
        slaResolutionBreached: false,
        isMerged: false,
      },
    });

    for (const ticket of resolutionBreaches) {
      if (!(await this.flagBreach(ticket, 'slaResolutionBreached'))) continue;
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SLA_BREACHED,
        new SlaBreachedEvent(ticket, 'resolution'),
      );
    }
  }

  /** Sets the flag only if still unset, so concurrent ticks emit once. */
  private async flagBreach(
    ticket: Ticket,
    flag: 'slaFirstResponseBreached' | 'slaResolutionBreached',
  ): Promise<boolean> {
    const result = await this.ticketRepo.update(
      { id: ticket.id, [flag]: false } as any,
      { [flag]: true, slaBreached: true } as any,
    );
    if (result.affected === 0) return false;
    Object.assign(ticket, { [flag]: true, slaBreached: true });
    return true;
  }

  /**
   * Emits `sla.warning` once per deadline that falls due within the next
   * `warningMinutes` (Laravel `SlaService::checkWarnings`, but recorded so it
   * is not repeated every tick). Returns how many warnings were sent.
   */
  async checkWarnings(warningMinutes = 30): Promise<number> {
    if (!(warningMinutes > 0)) return 0;
    const now = new Date();
    const threshold = new Date(now.getTime() + warningMinutes * 60000);
    let warned = 0;

    const firstResponse = await this.ticketRepo.find({
      where: {
        firstResponseDueAt: Between(now, threshold),
        firstRespondedAt: IsNull(),
        resolvedAt: IsNull(),
        slaFirstResponseBreached: false,
        slaFirstResponseWarned: false,
        isMerged: false,
      },
    });
    for (const ticket of firstResponse) {
      if (!(await this.flagWarning(ticket, 'slaFirstResponseWarned'))) continue;
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SLA_WARNING,
        new SlaWarningEvent(ticket, 'first_response', minutesUntil(ticket.firstResponseDueAt, now)),
      );
      warned++;
    }

    const resolution = await this.ticketRepo.find({
      where: {
        resolutionDueAt: Between(now, threshold),
        resolvedAt: IsNull(),
        slaResolutionBreached: false,
        slaResolutionWarned: false,
        isMerged: false,
      },
    });
    for (const ticket of resolution) {
      if (!(await this.flagWarning(ticket, 'slaResolutionWarned'))) continue;
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SLA_WARNING,
        new SlaWarningEvent(ticket, 'resolution', minutesUntil(ticket.resolutionDueAt, now)),
      );
      warned++;
    }

    return warned;
  }

  private async flagWarning(
    ticket: Ticket,
    flag: 'slaFirstResponseWarned' | 'slaResolutionWarned',
  ): Promise<boolean> {
    const result = await this.ticketRepo.update(
      { id: ticket.id, [flag]: false } as any,
      { [flag]: true } as any,
    );
    if (result.affected === 0) return false;
    Object.assign(ticket, { [flag]: true });
    return true;
  }

  private async findMatchingPolicy(ticket: Ticket): Promise<SlaPolicy | null> {
    if (this.access?.options.targetedSlas) {
      const policies = await this.slaPolicyRepo.find({
        where: { isActive: true },
        order: { id: 'ASC' },
      });
      const rank = (policy: SlaPolicy) =>
        policy.departmentId != null
          ? policy.ticketType != null
            ? 0
            : 1
          : policy.ticketType != null
            ? 2
            : 3;
      return (
        policies
          .filter(
            (policy) =>
              (policy.departmentId == null || policy.departmentId === ticket.departmentId) &&
              (policy.ticketType == null || policy.ticketType === ticket.ticketType) &&
              (policy.departmentId != null || policy.ticketType != null || policy.isDefault),
          )
          .sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0] ?? null
      );
    }
    // First try to find policy matching conditions
    const policies = await this.slaPolicyRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });

    for (const policy of policies) {
      if (
        policy.departmentId == null &&
        policy.ticketType == null &&
        this.matchesConditions(ticket, policy.conditions)
      ) {
        return policy;
      }
    }

    // Fall back to default
    return this.slaPolicyRepo.findOne({
      where: { isDefault: true, isActive: true, departmentId: IsNull(), ticketType: IsNull() },
    });
  }

  private matchesConditions(ticket: Ticket, conditions: Record<string, any> | null): boolean {
    if (!conditions || Object.keys(conditions).length === 0) return false;

    if (conditions.priority && conditions.priority !== ticket.priority) return false;
    if (conditions.departmentId && conditions.departmentId !== ticket.departmentId) return false;
    if (conditions.channel && conditions.channel !== ticket.channel) return false;

    return true;
  }

  private getFirstResponseMinutes(policy: SlaPolicy, priority: string): number {
    switch (priority) {
      case 'urgent':
        return policy.firstResponseUrgent;
      case 'high':
        return policy.firstResponseHigh;
      case 'medium':
        return policy.firstResponseMedium;
      case 'low':
        return policy.firstResponseLow;
      default:
        return policy.firstResponseMedium;
    }
  }

  private getResolutionMinutes(policy: SlaPolicy, priority: string): number {
    switch (priority) {
      case 'urgent':
        return policy.resolutionUrgent;
      case 'high':
        return policy.resolutionHigh;
      case 'medium':
        return policy.resolutionMedium;
      case 'low':
        return policy.resolutionLow;
      default:
        return policy.resolutionMedium;
    }
  }

  /**
   * The business schedule a business-hours policy counts in, chosen as
   * escalated-laravel does: the policy's own, else the ticket department's,
   * else the default schedule. Null when none applies, and the deadline is
   * counted in calendar time as before.
   */
  async scheduleFor(policy: SlaPolicy, ticket: Ticket): Promise<BusinessSchedule | null> {
    const ids: number[] = [];
    if (policy.businessScheduleId != null) ids.push(policy.businessScheduleId);
    if (ticket.departmentId != null) {
      const department = await this.scheduleRepo.manager
        ?.getRepository(Department)
        .findOne({ where: { id: ticket.departmentId } });
      if (department?.businessScheduleId != null) ids.push(department.businessScheduleId);
    }

    for (const id of ids) {
      const schedule = await this.scheduleRepo.findOne({
        where: { id },
        relations: { holidays: true },
      });
      if (schedule) return schedule;
    }

    return (
      (await this.scheduleRepo.findOne({
        where: { isDefault: true },
        order: { id: 'ASC' },
        relations: { holidays: true },
      })) ?? null
    );
  }

  /** `minutes` of business time after `start`, in the schedule's zone and holidays. */
  addBusinessMinutes(start: Date, minutes: number, schedule: BusinessSchedule): Date {
    return addBusinessMinutes(start, minutes, schedule);
  }
}

function minutesUntil(due: Date | string | null | undefined, now: Date): number {
  if (!due) return 0;
  return Math.max(0, Math.floor((new Date(due).getTime() - now.getTime()) / 60000));
}
