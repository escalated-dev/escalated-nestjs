import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowLog } from '../entities/workflow-log.entity';
import { Ticket } from '../entities/ticket.entity';
import { WorkflowEngineService } from './workflow-engine.service';
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
  ) {}

  async runForEvent(triggerEvent: string, ticket: Ticket): Promise<void> {
    const workflows = await this.workflowRepo.find({
      where: { triggerEvent, isActive: true },
      order: { position: 'ASC' },
    });
    if (workflows.length === 0) return;

    const conditionMap = this.ticketToConditionMap(ticket);

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
          await this.executor.execute(ticket, wf.actions as unknown as WorkflowAction[]);
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
   * Flattens a ticket into a string-keyed / string-valued map for the
   * condition evaluator (which treats all fields as strings).
   */
  private ticketToConditionMap(ticket: Ticket): Record<string, string> {
    const map: Record<string, string> = {};
    const source = ticket as unknown as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      const val = source[key];
      if (val === null || val === undefined) {
        map[key] = '';
      } else if (typeof val === 'object') {
        // Skip relations / arrays; condition eval only handles scalars
        continue;
      } else {
        map[key] = String(val);
      }
    }
    return map;
  }
}
