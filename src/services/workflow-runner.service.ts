import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowLog } from '../entities/workflow-log.entity';
import { Ticket } from '../entities/ticket.entity';
import { WorkflowEngineService, type ConditionMap } from './workflow-engine.service';
import { aliasesOf, canonicalEvent } from '../events/event-names';
import { WorkflowExecutorService, type WorkflowAction } from './workflow-executor.service';

/**
 * Orchestrates evaluation + execution of Workflows for a given trigger
 * event. For each active Workflow matching the trigger (in `position` order),
 * evaluates conditions via WorkflowEngineService and, if matched, dispatches
 * to WorkflowExecutorService. Writes a WorkflowLog row per Workflow
 * considered. Honors `stopOnMatch`.
 *
 * Executor errors are caught so one misbehaving workflow doesn't block the
 * rest — the failure is stamped on its log row.
 */
@Injectable()
export class WorkflowRunnerService {
  private readonly logger = new Logger(WorkflowRunnerService.name);

  constructor(
    @InjectRepository(Workflow) private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(WorkflowLog) private readonly logRepo: Repository<WorkflowLog>,
    private readonly engine: WorkflowEngineService,
    private readonly executor: WorkflowExecutorService,
    @Optional() @InjectRepository(Ticket) private readonly ticketRepo?: Repository<Ticket>,
  ) {}

  async runForEvent(event: string, ticket: Ticket): Promise<void> {
    const triggerEvent = canonicalEvent(event);
    // Workflows saved with a legacy trigger name (`ticket.replied`, ...) still run.
    const workflows = await this.workflowRepo.find({
      where: { triggerEvent: In(aliasesOf(triggerEvent)), isActive: true },
      order: { position: 'ASC' },
    });
    if (workflows.length === 0) return;

    const current = await this.withRelations(ticket);
    const conditionMap = this.ticketToConditionMap(current);

    for (const wf of workflows) {
      const startedAt = new Date();
      const matched = this.engine.evaluateConditions(wf.conditions as any, conditionMap);
      const log = await this.logRepo.save({
        workflow: { id: wf.id },
        ticket: { id: ticket.id },
        triggerEvent,
        conditionsMatched: matched,
        actionsExecutedRaw: matched ? (wf.actions as Array<Record<string, unknown>>) : [],
        startedAt,
      });

      if (matched) {
        try {
          await this.executor.execute(current, wf.actions as unknown as WorkflowAction[]);
          await this.logRepo.update({ id: (log as WorkflowLog).id }, { completedAt: new Date() });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Workflow #${wf.id} (${wf.name}) failed on ticket #${ticket.id}: ${msg}`,
          );
          await this.logRepo.update(
            { id: (log as WorkflowLog).id },
            { errorMessage: msg, completedAt: new Date() },
          );
        }
        if (wf.stopOnMatch) break;
      }
    }
  }

  /**
   * The ticket as stored, with the status and tags that conditions read.
   * Events can carry a copy taken before the change was written.
   */
  private async withRelations(ticket: Ticket): Promise<Ticket> {
    if (!this.ticketRepo || ticket?.id == null) return ticket;
    const loaded = await this.ticketRepo.findOne({
      where: { id: ticket.id },
      relations: { status: true, tags: true },
    });
    return loaded ?? ticket;
  }

  /**
   * Flattens a ticket into the map the condition evaluator reads: scalar
   * columns as strings (camelCase, with the contract's snake_case fields
   * aliased by the engine), plus `status` (the status slug), `assigned_to`,
   * `tags` (tag names and slugs) and `hours_since_created`/`_updated`.
   */
  private ticketToConditionMap(ticket: Ticket): ConditionMap {
    const map: ConditionMap = {};
    const source = ticket as unknown as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      const val = source[key];
      if (val === null || val === undefined) {
        map[key] = '';
      } else if (val instanceof Date) {
        map[key] = val.toISOString();
      } else if (typeof val === 'object') {
        // Relations are mapped below.
        continue;
      } else {
        map[key] = String(val);
      }
    }
    const status = ticket.status as { slug?: string } | undefined;
    map.status = status?.slug ?? '';
    map.assigned_to = ticket.assigneeId == null ? '' : String(ticket.assigneeId);
    const tags = Array.isArray(ticket.tags) ? ticket.tags : [];
    map.tags = [
      ...new Set(tags.flatMap((tag) => [tag.name, tag.slug].filter(Boolean) as string[])),
    ];
    const now = Date.now();
    const hoursSince = (value: unknown) =>
      value ? String(Math.floor((now - new Date(value as string).getTime()) / 3600000)) : '';
    map.hours_since_created = hoursSince(ticket.createdAt);
    map.hours_since_updated = hoursSince(ticket.updatedAt);
    return map;
  }
}
