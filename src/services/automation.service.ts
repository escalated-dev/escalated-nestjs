import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Automation } from '../entities/automation.entity';
import { Ticket } from '../entities/ticket.entity';
import { Tag } from '../entities/tag.entity';
import { Reply } from '../entities/reply.entity';

/**
 * AutomationService — admin time-based rules engine.
 *
 * Distinct from WorkflowEngineService (event-driven, fires on
 * ticket.created etc.) and MacroService (agent-applied, manual).
 *
 * The cron tick (registered separately) calls run() periodically. Each
 * active automation is evaluated against open tickets matching its
 * conditions; matching tickets get the automation's actions applied.
 *
 * See escalated-developer-context/domain-model/workflows-automations-macros.md.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(Automation)
    private readonly automationRepo: Repository<Automation>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Tag)
    private readonly tagRepo: Repository<Tag>,
    @InjectRepository(Reply)
    private readonly replyRepo: Repository<Reply>,
  ) {}

  // ---------------- CRUD ----------------

  async findAll(): Promise<Automation[]> {
    return this.automationRepo.find({ order: { position: 'ASC', id: 'ASC' } });
  }

  async findById(id: number): Promise<Automation> {
    const a = await this.automationRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Automation #${id} not found`);
    return a;
  }

  async create(data: Partial<Automation>): Promise<Automation> {
    const a = this.automationRepo.create(data);
    return this.automationRepo.save(a);
  }

  async update(id: number, data: Partial<Automation>): Promise<Automation> {
    await this.findById(id);
    await this.automationRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    await this.findById(id);
    await this.automationRepo.delete(id);
  }

  // ---------------- Runner ----------------

  /**
   * Evaluate all active automations against open tickets and execute
   * matched actions. Returns the count of tickets affected (each
   * matching ticket counts once per automation that touched it).
   */
  async run(): Promise<number> {
    const automations = await this.automationRepo.find({
      where: { active: true },
      order: { position: 'ASC', id: 'ASC' },
    });

    let affected = 0;

    for (const automation of automations) {
      try {
        const tickets = await this.findMatchingTickets(automation);
        for (const ticket of tickets) {
          await this.executeActions(automation, ticket);
          affected++;
        }
        await this.automationRepo.update(automation.id, { lastRunAt: new Date() });
      } catch (e) {
        this.logger.warn(
          `Automation #${automation.id} (${automation.name}) failed: ${(e as Error).message}`,
        );
      }
    }

    return affected;
  }

  /**
   * Find open tickets matching all of the automation's conditions (AND).
   *
   * The condition vocabulary is intentionally narrow — these are the
   * fields that make sense for a time-based scan. Workflows have a
   * different vocabulary because they evaluate against a single ticket
   * at the moment of an event.
   */
  private async findMatchingTickets(automation: Automation): Promise<Ticket[]> {
    const qb = this.ticketRepo.createQueryBuilder('ticket').where('ticket.deletedAt IS NULL');

    // Open = not yet resolved or closed. Lifecycle is tracked by the
    // resolvedAt / closedAt timestamps on the ticket; status names live
    // on the TicketStatus relation. Mirror Laravel's `Ticket::open()`
    // scope semantics with timestamp checks.
    qb.andWhere('ticket.resolvedAt IS NULL').andWhere('ticket.closedAt IS NULL');

    for (const condition of automation.conditions ?? []) {
      const field = condition.field ?? '';
      const operator = condition.operator ?? '>';
      const value = condition.value;

      switch (field) {
        case 'hours_since_created': {
          const threshold = this.hoursAgo(Number(value));
          qb.andWhere(`ticket.createdAt ${this.flipOperator(operator)} :hsc`, { hsc: threshold });
          break;
        }
        case 'hours_since_updated': {
          const threshold = this.hoursAgo(Number(value));
          qb.andWhere(`ticket.updatedAt ${this.flipOperator(operator)} :hsu`, { hsu: threshold });
          break;
        }
        case 'hours_since_assigned': {
          const threshold = this.hoursAgo(Number(value));
          qb.andWhere('ticket.assigneeId IS NOT NULL').andWhere(
            `ticket.updatedAt ${this.flipOperator(operator)} :hsa`,
            { hsa: threshold },
          );
          break;
        }
        case 'status_id':
          qb.andWhere('ticket.statusId = :statusId', { statusId: Number(value) });
          break;
        case 'priority':
          qb.andWhere('ticket.priority = :priority', { priority: value });
          break;
        case 'assigned':
          if (value === 'unassigned') qb.andWhere('ticket.assigneeId IS NULL');
          else if (value === 'assigned') qb.andWhere('ticket.assigneeId IS NOT NULL');
          break;
        case 'subject_contains':
          qb.andWhere('ticket.subject LIKE :sc', { sc: `%${value}%` });
          break;
        // Unknown field — skip silently. Authors get to add new fields
        // without breaking older saved automations.
      }
    }

    return qb.getMany();
  }

  /**
   * Execute the automation's actions on a single matched ticket.
   *
   * Errors per-action are caught and logged; one bad action does not
   * abort the rest of the action list (matches Laravel reference behavior).
   */
  private async executeActions(automation: Automation, ticket: Ticket): Promise<void> {
    for (const action of automation.actions ?? []) {
      const type = action.type ?? '';
      const value = action.value;

      try {
        switch (type) {
          case 'change_status':
            // Value is a TicketStatus.id. Frontend renders a dropdown.
            await this.ticketRepo.update(ticket.id, { statusId: Number(value) });
            break;
          case 'change_priority':
            await this.ticketRepo.update(ticket.id, { priority: String(value) });
            break;
          case 'assign':
            await this.ticketRepo.update(ticket.id, { assigneeId: Number(value) });
            break;
          case 'add_tag': {
            const tag = await this.tagRepo.findOne({ where: { name: String(value) } });
            if (tag) {
              const t = await this.ticketRepo.findOne({
                where: { id: ticket.id },
                relations: ['tags'],
              });
              if (t && !t.tags?.some((x) => x.id === tag.id)) {
                t.tags = [...(t.tags ?? []), tag];
                await this.ticketRepo.save(t);
              }
            }
            break;
          }
          case 'add_note':
            await this.replyRepo.save(
              this.replyRepo.create({
                ticketId: ticket.id,
                body: String(value),
                isInternalNote: true,
                metadata: { system_note: true, automation_id: automation.id },
              } as Partial<Reply>),
            );
            break;
          // Unknown action type — skip.
        }
      } catch (e) {
        this.logger.warn(
          `Automation #${automation.id} action '${type}' on ticket #${ticket.id} failed: ${(e as Error).message}`,
        );
      }
    }
  }

  // For `hours_since_*` fields: "hours_since_created > 48" means
  // the ticket's createdAt is older than 48h ago, i.e.
  // `createdAt < (now - 48h)`. So the SQL operator is the inverse
  // of the user-facing one.
  private flipOperator(op: string): string {
    switch (op) {
      case '>':
        return '<';
      case '>=':
        return '<=';
      case '<':
        return '>';
      case '<=':
        return '>=';
      case '=':
        return '=';
      default:
        return '<';
    }
  }

  private hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }
}

// Re-export the comparison operators for any consumer that wants typed
// queries elsewhere.
export const _typeormOpRefs = { LessThan, MoreThan, LessThanOrEqual, MoreThanOrEqual };
