import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EscalationRule } from '../entities/escalation-rule.entity';
import { Ticket } from '../entities/ticket.entity';
import { SlaPolicy } from '../entities/sla-policy.entity';

@Injectable()
export class EscalationService {
  constructor(
    @InjectRepository(EscalationRule)
    private readonly ruleRepo: Repository<EscalationRule>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(SlaPolicy)
    private readonly slaPolicyRepo: Repository<SlaPolicy>,
  ) {}

  async findAll(slaPolicyId?: number): Promise<EscalationRule[]> {
    const where: any = {};
    if (slaPolicyId) where.slaPolicyId = slaPolicyId;
    return this.ruleRepo.find({ where, order: { sortOrder: 'ASC' } });
  }

  async findById(id: number): Promise<EscalationRule> {
    const rule = await this.ruleRepo.findOne({ where: { id }, relations: ['slaPolicy'] });
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
      relations: ['slaPolicy'],
    });

    for (const rule of rules) {
      const tickets = await this.getEscalationCandidates(rule, now);
      for (const ticket of tickets) {
        await this.executeActions(ticket, rule);
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

    return qb.getMany();
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
