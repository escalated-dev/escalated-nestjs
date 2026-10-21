import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowLog } from '../entities/workflow-log.entity';
import { canonicalEvent } from '../events/event-names';
import { WORKFLOW_TRIGGERS } from '../events/workflow-triggers';
import { OPERATORS, WORKFLOW_ACTIONS } from './workflow-engine.service';
import { validateWorkflowPayload, type WorkflowPayload } from '../dto/workflow-payload';

/** A workflow as the shared admin UI reads it (workflow-admin-contract.md). */
export interface WorkflowJson {
  id: number;
  name: string;
  description: string | null;
  trigger_event: string;
  /** Read-only alias of `trigger_event`. */
  trigger: string;
  conditions: Record<string, unknown> | unknown[];
  actions: Array<Record<string, unknown>>;
  is_active: boolean;
  position: number;
  stop_on_match: boolean;
  trigger_count: number;
  last_triggered_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface WorkflowLogJson {
  id: number;
  workflow_id: number | null;
  workflow_name: string | null;
  ticket_id: number | null;
  ticket_reference: string | null;
  trigger_event: string;
  event: string;
  matched: boolean;
  actions_executed: number;
  action_details: Array<Record<string, unknown>>;
  duration_ms: number | null;
  status: 'success' | 'failed';
  error_message: string | null;
  created_at: string | null;
}

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

/**
 * Admin CRUD for Workflows, on the wire contract the shared builder uses.
 * Engine evaluation lives in WorkflowRunnerService.
 */
@Injectable()
export class WorkflowAdminService {
  constructor(
    @InjectRepository(Workflow) private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(WorkflowLog) private readonly logRepo: Repository<WorkflowLog>,
  ) {}

  /** The Form page's option lists: exactly what this backend fires and executes. */
  options() {
    return {
      trigger_events: WORKFLOW_TRIGGERS,
      action_types: WORKFLOW_ACTIONS,
      operators: [...OPERATORS],
    };
  }

  async list(): Promise<WorkflowJson[]> {
    const workflows = await this.workflowRepo.find({ order: { position: 'ASC', id: 'ASC' } });
    const stats = await this.stats(workflows.map((w) => w.id));
    return workflows.map((w) => this.toJson(w, stats.get(w.id)));
  }

  async show(id: number): Promise<WorkflowJson> {
    const workflow = await this.find(id);
    return this.toJson(workflow, (await this.stats([id])).get(id));
  }

  async create(body: unknown): Promise<WorkflowJson> {
    const data = this.validate(body);
    const last = await this.workflowRepo
      .createQueryBuilder('workflow')
      .select('MAX(workflow.position)', 'max')
      .getRawOne<{ max: number | string | null }>();
    const saved = await this.workflowRepo.save(
      this.workflowRepo.create({
        name: data.name,
        description: data.description,
        triggerEvent: data.trigger_event,
        conditions: data.conditions as unknown as Record<string, unknown>,
        actions: data.actions as unknown as Array<Record<string, unknown>>,
        isActive: data.is_active,
        position: last?.max == null ? 0 : Number(last.max) + 1,
      }),
    );
    return this.show(saved.id);
  }

  async update(id: number, body: unknown): Promise<WorkflowJson> {
    const workflow = await this.find(id);
    const data = this.validate(body);
    Object.assign(workflow, {
      name: data.name,
      description: data.description,
      triggerEvent: data.trigger_event,
      conditions: data.conditions,
      actions: data.actions,
      isActive: data.is_active,
    });
    await this.workflowRepo.save(workflow);
    return this.show(id);
  }

  async delete(id: number): Promise<void> {
    const workflow = await this.find(id);
    await this.logRepo.delete({ workflow: { id } });
    await this.workflowRepo.remove(workflow);
  }

  async toggle(id: number): Promise<WorkflowJson> {
    const workflow = await this.find(id);
    await this.workflowRepo.update(id, { isActive: !workflow.isActive });
    return this.show(id);
  }

  /** `workflow_ids` in their new order; positions follow it. Unknown ids are ignored. */
  async reorder(body: unknown): Promise<WorkflowJson[]> {
    const ids = (body as { workflow_ids?: unknown })?.workflow_ids;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(Number(id)))) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: { workflow_ids: ['Send the workflow ids in their new order.'] },
      });
    }
    for (const [position, id] of ids.entries()) {
      await this.workflowRepo.update(Number(id), { position });
    }
    return this.list();
  }

  /** The newest logs (100), for one workflow or all of them. */
  async logs(workflowId?: number): Promise<WorkflowLogJson[]> {
    if (workflowId !== undefined) await this.find(workflowId);
    const logs = await this.logRepo.find({
      where: workflowId !== undefined ? { workflow: { id: workflowId } } : {},
      relations: { workflow: true, ticket: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 100,
    });
    return logs.map((log) => ({
      id: log.id,
      workflow_id: log.workflow?.id ?? null,
      workflow_name: log.workflowName,
      ticket_id: log.ticket?.id ?? null,
      ticket_reference: log.ticketReference,
      trigger_event: canonicalEvent(log.triggerEvent),
      event: canonicalEvent(log.triggerEvent),
      matched: Boolean(log.conditionsMatched),
      actions_executed: log.actionsExecuted,
      action_details: log.actionDetails,
      duration_ms: log.durationMs,
      status: log.errorMessage ? 'failed' : 'success',
      error_message: log.errorMessage,
      created_at: iso(log.createdAt),
    }));
  }

  private validate(body: unknown) {
    const result = validateWorkflowPayload(body);
    if (result.ok === false) {
      throw new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: (result as { errors: Record<string, string[]> }).errors,
      });
    }
    return (result as { data: WorkflowPayload }).data;
  }

  private async find(id: number): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOne({ where: { id } });
    if (!workflow) throw new NotFoundException(`Workflow #${id} not found`);
    return workflow;
  }

  /** Matched runs per workflow, and the last one. */
  private async stats(ids: number[]) {
    const stats = new Map<number, { count: number; last: string | null }>();
    if (ids.length === 0) return stats;
    const matched = await this.logRepo.find({
      where: { workflow: { id: In(ids) }, conditionsMatched: true },
      relations: { workflow: true },
      select: { id: true, createdAt: true, workflow: { id: true } },
    });
    for (const log of matched) {
      const id = log.workflow?.id;
      if (id == null) continue;
      const entry = stats.get(id) ?? { count: 0, last: null };
      entry.count += 1;
      const at = iso(log.createdAt);
      if (at && (!entry.last || at > entry.last)) entry.last = at;
      stats.set(id, entry);
    }
    return stats;
  }

  private toJson(workflow: Workflow, stats?: { count: number; last: string | null }): WorkflowJson {
    const trigger = canonicalEvent(workflow.triggerEvent);
    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? null,
      // A trigger stored under a legacy name reads as its canonical name.
      trigger_event: trigger,
      trigger,
      conditions: (workflow.conditions as Record<string, unknown>) ?? { all: [] },
      actions: workflow.actions ?? [],
      is_active: Boolean(workflow.isActive),
      position: workflow.position,
      stop_on_match: Boolean(workflow.stopOnMatch),
      trigger_count: stats?.count ?? 0,
      last_triggered_at: stats?.last ?? null,
      created_at: iso(workflow.createdAt),
      updated_at: iso(workflow.updatedAt),
    };
  }
}
