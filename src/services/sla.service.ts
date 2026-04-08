import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaPolicy } from '../entities/sla-policy.entity';
import { BusinessSchedule } from '../entities/business-schedule.entity';
import { Ticket } from '../entities/ticket.entity';
import { ESCALATED_EVENTS, SlaBreachedEvent } from '../events/escalated.events';

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
  ) {}

  async findAll(): Promise<SlaPolicy[]> {
    return this.slaPolicyRepo.find({
      order: { sortOrder: 'ASC' },
      relations: ['escalationRules'],
    });
  }

  async findById(id: number): Promise<SlaPolicy> {
    const policy = await this.slaPolicyRepo.findOne({
      where: { id },
      relations: ['escalationRules'],
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

    const now = new Date();
    let firstResponseDue = now;
    let resolutionDue = now;

    // If business schedule exists, calculate using business hours
    if (policy.businessScheduleId) {
      const schedule = await this.scheduleRepo.findOne({
        where: { id: policy.businessScheduleId },
      });
      if (schedule) {
        firstResponseDue = this.addBusinessMinutes(now, firstResponseMinutes, schedule);
        resolutionDue = this.addBusinessMinutes(now, resolutionMinutes, schedule);
      } else {
        firstResponseDue = new Date(now.getTime() + firstResponseMinutes * 60000);
        resolutionDue = new Date(now.getTime() + resolutionMinutes * 60000);
      }
    } else {
      firstResponseDue = new Date(now.getTime() + firstResponseMinutes * 60000);
      resolutionDue = new Date(now.getTime() + resolutionMinutes * 60000);
    }

    await this.ticketRepo.update(ticket.id, {
      slaPolicyId: policy.id,
      firstResponseDueAt: firstResponseDue,
      resolutionDueAt: resolutionDue,
    });
  }

  async checkBreaches(): Promise<void> {
    const now = new Date();

    // Check first response breaches
    const firstResponseBreaches = await this.ticketRepo.find({
      where: {
        firstResponseDueAt: LessThan(now),
        firstRespondedAt: IsNull(),
        slaBreached: false,
        isMerged: false,
      },
    });

    for (const ticket of firstResponseBreaches) {
      await this.ticketRepo.update(ticket.id, { slaBreached: true });
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SLA_BREACHED,
        new SlaBreachedEvent(ticket, 'first_response'),
      );
    }

    // Check resolution breaches
    const resolutionBreaches = await this.ticketRepo.find({
      where: {
        resolutionDueAt: LessThan(now),
        resolvedAt: IsNull(),
        isMerged: false,
      },
    });

    for (const ticket of resolutionBreaches) {
      if (!ticket.slaBreached) {
        await this.ticketRepo.update(ticket.id, { slaBreached: true });
      }
      this.eventEmitter.emit(
        ESCALATED_EVENTS.SLA_BREACHED,
        new SlaBreachedEvent(ticket, 'resolution'),
      );
    }
  }

  private async findMatchingPolicy(ticket: Ticket): Promise<SlaPolicy | null> {
    // First try to find policy matching conditions
    const policies = await this.slaPolicyRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });

    for (const policy of policies) {
      if (this.matchesConditions(ticket, policy.conditions)) {
        return policy;
      }
    }

    // Fall back to default
    return this.slaPolicyRepo.findOne({ where: { isDefault: true, isActive: true } });
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

  addBusinessMinutes(start: Date, minutes: number, schedule: BusinessSchedule): Date {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    let remaining = minutes;
    const current = new Date(start);

    while (remaining > 0) {
      const dayName = days[current.getDay()];
      const daySchedule = schedule.schedule[dayName];

      if (daySchedule?.enabled) {
        const [startH, startM] = daySchedule.start.split(':').map(Number);
        const [endH, endM] = daySchedule.end.split(':').map(Number);

        const dayStart = new Date(current);
        dayStart.setHours(startH, startM, 0, 0);
        const dayEnd = new Date(current);
        dayEnd.setHours(endH, endM, 0, 0);

        const effectiveStart = current > dayStart ? current : dayStart;

        if (effectiveStart < dayEnd) {
          const availableMinutes = (dayEnd.getTime() - effectiveStart.getTime()) / 60000;

          if (remaining <= availableMinutes) {
            return new Date(effectiveStart.getTime() + remaining * 60000);
          }

          remaining -= availableMinutes;
        }
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }

    return current;
  }
}
