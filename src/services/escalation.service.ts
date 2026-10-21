import { accountIdentity, caseSensitiveEquals } from '../config/ticket-access';
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EscalationRule } from '../entities/escalation-rule.entity';
import { Ticket } from '../entities/ticket.entity';
import { SlaPolicy } from '../entities/sla-policy.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { ESCALATED_EVENTS, TicketEscalatedEvent } from '../events/escalated.events';

@Injectable()
export class EscalationService {
  constructor(
    @InjectRepository(EscalationRule)
    private readonly ruleRepo: Repository<EscalationRule>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(SlaPolicy)
    private readonly slaPolicyRepo: Repository<SlaPolicy>,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional()
    @InjectRepository(TicketActivity)
    private readonly activityRepo?: Repository<TicketActivity>,
  ) {}

  async findAll(slaPolicyId?: number): Promise<EscalationRule[]> {
    const where: any = {};
    if (slaPolicyId) where.slaPolicyId = slaPolicyId;
    return this.ruleRepo.find({ where, order: { sortOrder: 'ASC' } });
  }

  async findById(id: number): Promise<EscalationRule> {
    const rule = await this.ruleRepo.findOne({ where: { id }, relations: { slaPolicy: true } });
    if (!rule) throw new NotFoundException(`Escalation rule #${id} not found`);
    return rule;
  }

  async create(data: Partial<EscalationRule>): Promise<EscalationRule> {
    const rule = this.ruleRepo.create(data);
    return this.ruleRepo.save(rule);
  }

  async update(id: number, data: Partial<EscalationRule>): Promise<EscalationRule> {
    await this.findById(id);
    await this.ruleRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const rule = await this.findById(id);
    await this.ruleRepo.remove(rule);
  }

  async processEscalations(): Promise<void> {
    const now = new Date();
    const rules = await this.ruleRepo.find({
      where: { isActive: true },
      relations: { slaPolicy: true },
    });

    for (const rule of rules) {
      const tickets = await this.getEscalationCandidates(rule, now);
      for (const ticket of tickets) {
        await this.executeActions(ticket, rule);
        await this.announce(ticket, rule);
      }
    }
  }

  private async getEscalationCandidates(rule: EscalationRule, now: Date): Promise<Ticket[]> {
    const qb = this.ticketRepo
      .createQueryBuilder('ticket')
      .where('ticket.slaPolicyId = :slaPolicyId', { slaPolicyId: rule.slaPolicyId })
      .andWhere('ticket.isMerged = :isMerged', { isMerged: false });

    if (rule.triggerType === 'first_response_breach') {
      qb.andWhere('ticket.firstResponseDueAt < :now', { now }).andWhere(
        'ticket.firstRespondedAt IS NULL',
      );
    } else if (rule.triggerType === 'resolution_breach') {
      qb.andWhere('ticket.resolutionDueAt < :now', { now }).andWhere('ticket.resolvedAt IS NULL');
    } else if (rule.triggerType === 'approaching_breach') {
      const threshold = new Date(now.getTime() + rule.minutesBefore * 60000);
      qb.andWhere('ticket.firstResponseDueAt <= :threshold', { threshold })
        .andWhere('ticket.firstResponseDueAt > :now', { now })
        .andWhere('ticket.firstRespondedAt IS NULL');
    }

    for (const [field, value] of Object.entries(rule.conditions ?? {})) {
      if (field === 'account') {
        const account = accountIdentity(value);
        if (!account) {
          qb.andWhere('1 = 0');
          continue;
        }
        qb.andWhere(caseSensitiveEquals(qb.connection, 'ticket.accountType', ':accountType'), {
          accountType: account.type,
        });
        qb.andWhere(caseSensitiveEquals(qb.connection, 'ticket.accountId', ':accountId'), {
          accountId: account.id,
        });
      } else {
        const property = {
          ticket_type: 'ticketType',
          department_id: 'departmentId',
          account_type: 'accountType',
          account_id: 'accountId',
        }[field];
        if (property) {
          const expression =
            field === 'department_id'
              ? `ticket.${property} = :routing_${property}`
              : caseSensitiveEquals(qb.connection, `ticket.${property}`, `:routing_${property}`);
          qb.andWhere(expression, { [`routing_${property}`]: value });
        }
      }
    }
    return qb.getMany();
  }

  /**
   * Records the escalation on the ticket and emits `ticket.escalated` the
   * first time a rule matches it. Rules re-apply their actions on every run,
   * but the event is not repeated.
   */
  private async announce(ticket: Ticket, rule: EscalationRule): Promise<void> {
    if (!this.activityRepo) return;
    const earlier = await this.activityRepo.find({
      where: { ticketId: ticket.id, action: 'escalated' },
    });
    if (earlier.some((activity) => Number(activity.newValue?.ruleId) === rule.id)) return;

    await this.activityRepo.save({
      ticketId: ticket.id,
      userId: null,
      action: 'escalated',
      newValue: { ruleId: rule.id },
      description: `Escalated by rule "${rule.name}"`,
    });
    const fresh = (await this.ticketRepo.findOne({ where: { id: ticket.id } })) ?? ticket;
    this.eventEmitter?.emit(
      ESCALATED_EVENTS.TICKET_ESCALATED,
      new TicketEscalatedEvent(fresh, rule.name),
    );
  }

  private async executeActions(ticket: Ticket, rule: EscalationRule): Promise<void> {
    for (const action of rule.actions) {
      switch (action.type) {
        case 'reassign':
          await this.ticketRepo.update(ticket.id, { assigneeId: action.value });
          break;
        case 'set_priority':
          await this.ticketRepo.update(ticket.id, { priority: action.value });
          break;
        case 'notify':
          // In a real implementation, this would send an email/notification
          break;
      }
    }
  }
}
