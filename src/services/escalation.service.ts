import { accountIdentity, caseSensitiveEquals } from '../config/ticket-access';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { EscalationRule } from '../entities/escalation-rule.entity';
import { RuleExecution } from '../entities/rule-execution.entity';
import { Ticket } from '../entities/ticket.entity';
import { SlaPolicy } from '../entities/sla-policy.entity';
import { TicketActivity } from '../entities/ticket-activity.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { ESCALATED_EVENTS, TicketEscalatedEvent } from '../events/escalated.events';
import { normalizeEscalationRule, RuleAction, RuleCondition } from './escalation-rules';
import { RuleFireLog } from './rule-fire-log.service';
import { TicketService } from './ticket.service';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

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
    @Optional() private readonly fireLog?: RuleFireLog,
    @Optional() private readonly tickets?: TicketService,
    @Optional()
    @InjectRepository(TicketStatus)
    private readonly statusRepo?: Repository<TicketStatus>,
  ) {}

  async findAll(slaPolicyId?: number): Promise<EscalationRule[]> {
    const where: any = {};
    if (slaPolicyId) where.slaPolicyId = slaPolicyId;
    return this.ruleRepo.find({ where, order: { sortOrder: 'ASC', id: 'ASC' } });
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

  /** Saving a rule re-arms it: it may fire again on tickets it already acted on. */
  async update(id: number, data: Partial<EscalationRule>): Promise<EscalationRule> {
    await this.findById(id);
    await this.ruleRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const rule = await this.findById(id);
    await this.ruleRepo.remove(rule);
    await this.fireLog?.forget(RuleExecution.ESCALATION_RULE, id);
  }

  /**
   * Runs every active rule against the open tickets it matches.
   *
   * A rule acts on a ticket once; it acts again only after the ticket has
   * stopped matching, or after the rule's `repeatAfterHours`. A failure on one
   * ticket is logged and the sweep carries on with the next. Returns the
   * number of rule/ticket pairs acted on.
   */
  async processEscalations(): Promise<number> {
    const now = new Date();
    const rules = await this.ruleRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    let escalated = 0;

    for (const rule of rules) {
      let tickets: Ticket[];
      try {
        const matching = await this.getEscalationCandidates(rule, now);
        tickets = this.fireLog
          ? await this.fireLog.due(
              RuleExecution.ESCALATION_RULE,
              rule.id,
              rule.repeatAfterHours,
              matching,
              now,
            )
          : matching;
      } catch (error) {
        this.logger.error(`Escalation rule #${rule.id} could not be evaluated: ${error}`);
        continue;
      }

      for (const ticket of tickets) {
        try {
          await this.executeActions(ticket, rule);
          await this.fireLog?.record(RuleExecution.ESCALATION_RULE, rule.id, ticket.id, now);
          escalated++;
        } catch (error) {
          this.logger.error(
            `Escalation rule #${rule.id} failed for ticket #${ticket.id}: ${error}`,
          );
        }
      }
    }
    return escalated;
  }

  /** The open tickets the rule's conditions match. */
  private async getEscalationCandidates(rule: EscalationRule, now: Date): Promise<Ticket[]> {
    const { conditions } = normalizeEscalationRule(rule);
    const qb = this.ticketRepo
      .createQueryBuilder('ticket')
      .leftJoin('ticket.status', 'ticketStatus')
      .where('ticket.isMerged = :isMerged', { isMerged: false })
      .andWhere(
        new Brackets((open) =>
          open.where('ticket.statusId IS NULL').orWhere(
            new Brackets((status) =>
              status
                .where('ticketStatus.isClosed = :notClosed', { notClosed: false })
                .andWhere('ticketStatus.slug NOT IN (:...terminal)', {
                  terminal: ['resolved', 'closed'],
                }),
            ),
          ),
        ),
      );

    conditions.forEach((condition, index) => this.constrain(qb, condition, `c${index}`, now));
    return qb.getMany();
  }

  private constrain(
    qb: SelectQueryBuilder<Ticket>,
    { field, value }: RuleCondition,
    key: string,
    now: Date,
  ): void {
    const hoursAgo = (hours: unknown) => new Date(now.getTime() - Number(hours) * 3_600_000);
    const text = (property: string) =>
      qb.andWhere(caseSensitiveEquals(qb.connection, `ticket.${property}`, `:${key}`), {
        [key]: String(value),
      });

    switch (field) {
      case 'status':
        qb.andWhere(`ticketStatus.slug = :${key}`, { [key]: String(value) });
        break;
      case 'priority':
        qb.andWhere(`ticket.priority = :${key}`, { [key]: String(value) });
        break;
      case 'assigned':
        qb.andWhere(
          value === 'unassigned' ? 'ticket.assigneeId IS NULL' : 'ticket.assigneeId IS NOT NULL',
        );
        break;
      case 'age_hours':
        qb.andWhere(`ticket.createdAt <= :${key}`, { [key]: hoursAgo(value) });
        break;
      case 'no_response_hours':
        qb.andWhere('ticket.firstRespondedAt IS NULL').andWhere(`ticket.createdAt <= :${key}`, {
          [key]: hoursAgo(value),
        });
        break;
      case 'sla_breached':
        qb.andWhere(
          new Brackets((breached) =>
            breached
              .where('ticket.slaBreached = :breached', { breached: true })
              .orWhere('ticket.slaFirstResponseBreached = :breached')
              .orWhere('ticket.slaResolutionBreached = :breached'),
          ),
        );
        break;
      case 'department_id':
        qb.andWhere(`ticket.departmentId = :${key}`, { [key]: Number(value) });
        break;
      case 'sla_policy_id':
        qb.andWhere(`ticket.slaPolicyId = :${key}`, { [key]: Number(value) });
        break;
      case 'ticket_type':
        text('ticketType');
        break;
      case 'account_type':
        text('accountType');
        break;
      case 'account_id':
        text('accountId');
        break;
      case 'account': {
        const account = accountIdentity(value);
        if (!account) {
          qb.andWhere('1 = 0');
          break;
        }
        qb.andWhere(caseSensitiveEquals(qb.connection, 'ticket.accountType', `:${key}t`), {
          [`${key}t`]: account.type,
        });
        qb.andWhere(caseSensitiveEquals(qb.connection, 'ticket.accountId', `:${key}i`), {
          [`${key}i`]: account.id,
        });
        break;
      }
      case 'first_response_breached':
        qb.andWhere(`ticket.firstResponseDueAt < :${key}`, { [key]: now }).andWhere(
          'ticket.firstRespondedAt IS NULL',
        );
        break;
      case 'resolution_breached':
        qb.andWhere(`ticket.resolutionDueAt < :${key}`, { [key]: now }).andWhere(
          'ticket.resolvedAt IS NULL',
        );
        break;
      case 'first_response_due_within_minutes':
        qb.andWhere(`ticket.firstResponseDueAt <= :${key}`, {
          [key]: new Date(now.getTime() + Number(value) * 60_000),
        })
          .andWhere(`ticket.firstResponseDueAt > :${key}now`, { [`${key}now`]: now })
          .andWhere('ticket.firstRespondedAt IS NULL');
        break;
      default:
        // Unknown and blank fields match every ticket, as in escalated-laravel.
        break;
    }
  }

  private async executeActions(ticket: Ticket, rule: EscalationRule): Promise<void> {
    const { actions, legacy } = normalizeEscalationRule(rule);
    let announced = false;

    for (const action of actions) {
      try {
        if (action.type === 'escalate') {
          announced = true;
          await this.escalate(ticket, rule);
        } else {
          await this.apply(ticket, action);
        }
      } catch (error) {
        this.logger.warn(
          `Escalation rule #${rule.id} action ${action.type} failed for ticket #${ticket.id}: ${error}`,
        );
      }
    }

    // Rules saved before the contract announce the escalation themselves.
    if (legacy && !announced) await this.announce(ticket, rule, rule.name);
  }

  /** Runs one ticket-changing action as the system, through the ticket service's events. */
  private async apply(ticket: Ticket, { type, value }: RuleAction): Promise<void> {
    let change: Record<string, unknown> | null = null;
    if (type === 'change_priority' && PRIORITIES.includes(String(value))) {
      change = { priority: String(value) };
    } else if (type === 'assign_to' && value !== null && value !== '') {
      change = { assigneeId: value };
    } else if (type === 'change_department' && Number.isInteger(Number(value)) && value !== '') {
      change = { departmentId: Number(value) };
    }
    if (!change) return;

    if (this.tickets) {
      await this.tickets.update(ticket.id, change as any, null as any);
    } else {
      await this.ticketRepo.update(ticket.id, change as any);
    }
  }

  /**
   * Moves the ticket to the `escalated` status when there is one, and
   * announces `ticket.escalated` with the rule as the reason. A ticket already
   * in that status is left alone, as in escalated-laravel.
   */
  private async escalate(ticket: Ticket, rule: EscalationRule): Promise<void> {
    const status = await this.statusRepo?.findOne({ where: { slug: 'escalated' } });
    const current = await this.ticketRepo.findOne({ where: { id: ticket.id } });
    if (status && current?.statusId === status.id) return;
    if (status && this.tickets) {
      await this.tickets.update(ticket.id, { statusId: status.id } as any, null as any);
    } else if (status) {
      await this.ticketRepo.update(ticket.id, { statusId: status.id });
    }
    await this.announce(ticket, rule, `Escalation rule: ${rule.name}`);
  }

  /** Records the escalation on the ticket and emits `ticket.escalated`. */
  private async announce(ticket: Ticket, rule: EscalationRule, reason: string): Promise<void> {
    await this.activityRepo?.save({
      ticketId: ticket.id,
      userId: null,
      action: 'escalated',
      newValue: { ruleId: rule.id },
      description: `Escalated by rule "${rule.name}"`,
    });
    const fresh = (await this.ticketRepo.findOne({ where: { id: ticket.id } })) ?? ticket;
    this.eventEmitter?.emit(
      ESCALATED_EVENTS.TICKET_ESCALATED,
      new TicketEscalatedEvent(fresh, reason),
    );
  }
}
