import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Workflow } from '../../src/entities/workflow.entity';
import { WorkflowLog } from '../../src/entities/workflow-log.entity';
import { WorkflowEngineService } from '../../src/services/workflow-engine.service';
import { WorkflowExecutorService } from '../../src/services/workflow-executor.service';
import { WorkflowRunnerService } from '../../src/services/workflow-runner.service';
import { buildTicket, buildWorkflow } from '../factories';
import type { Ticket } from '../../src/entities/ticket.entity';

describe('WorkflowRunnerService', () => {
  let runner: WorkflowRunnerService;
  let workflowRepo: any;
  let logRepo: any;
  let executor: { execute: jest.Mock };

  beforeEach(async () => {
    workflowRepo = {
      find: jest.fn(),
    };
    logRepo = {
      save: jest.fn(async (x) => ({ id: 1, ...x })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    executor = { execute: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRunnerService,
        WorkflowEngineService,
        { provide: getRepositoryToken(Workflow), useValue: workflowRepo },
        { provide: getRepositoryToken(WorkflowLog), useValue: logRepo },
        { provide: WorkflowExecutorService, useValue: executor },
      ],
    }).compile();

    runner = module.get(WorkflowRunnerService);
  });

  it('loads only active workflows for the trigger in position order', async () => {
    workflowRepo.find.mockResolvedValue([]);
    const ticket = buildTicket() as unknown as Ticket;
    await runner.runForEvent('ticket.created', ticket);
    expect(workflowRepo.find).toHaveBeenCalledWith({
      where: { triggerEvent: 'ticket.created', isActive: true },
      order: { position: 'ASC' },
    });
  });

  it('executes actions when conditions match', async () => {
    const wf = buildWorkflow({
      triggerEvent: 'ticket.created',
      conditions: {},
      actions: [{ type: 'change_priority', value: 'urgent' }],
    });
    workflowRepo.find.mockResolvedValue([wf]);
    const ticket = buildTicket({ priority: 'medium' }) as unknown as Ticket;

    await runner.runForEvent('ticket.created', ticket);

    expect(executor.execute).toHaveBeenCalledWith(ticket, wf.actions);
    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ conditionsMatched: true }),
    );
  });

  it('skips execution when conditions do not match but still logs', async () => {
    const wf = buildWorkflow({
      triggerEvent: 'ticket.created',
      conditions: { all: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
      actions: [{ type: 'change_priority', value: 'urgent' }],
    });
    workflowRepo.find.mockResolvedValue([wf]);
    const ticket = buildTicket({ priority: 'low' }) as unknown as Ticket;

    await runner.runForEvent('ticket.created', ticket);

    expect(executor.execute).not.toHaveBeenCalled();
    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ conditionsMatched: false }),
    );
  });

  it('honors stopOnMatch by halting after first match', async () => {
    const wf1 = buildWorkflow({ id: 1, position: 0, stopOnMatch: true, actions: [] });
    const wf2 = buildWorkflow({ id: 2, position: 1, actions: [] });
    workflowRepo.find.mockResolvedValue([wf1, wf2]);
    const ticket = buildTicket() as unknown as Ticket;

    await runner.runForEvent('ticket.created', ticket);

    // Only wf1 ran; wf2 should not have been logged
    expect(logRepo.save).toHaveBeenCalledTimes(1);
    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: { id: 1 } }),
    );
  });

  it('catches executor errors and stamps errorMessage on the log', async () => {
    const wf = buildWorkflow({ id: 9, actions: [{ type: 'change_priority', value: 'urgent' }] });
    workflowRepo.find.mockResolvedValue([wf]);
    executor.execute.mockRejectedValue(new Error('boom'));
    const ticket = buildTicket() as unknown as Ticket;

    await runner.runForEvent('ticket.created', ticket);

    expect(logRepo.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorMessage: expect.stringContaining('boom') }),
    );
  });

  it('maps ticket to a string-valued condition map for the engine', async () => {
    const engine = new WorkflowEngineService();
    const evalSpy = jest.spyOn(engine, 'evaluateConditions');
    // Recreate module with real engine instance so we can spy on it
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRunnerService,
        { provide: WorkflowEngineService, useValue: engine },
        { provide: getRepositoryToken(Workflow), useValue: workflowRepo },
        { provide: getRepositoryToken(WorkflowLog), useValue: logRepo },
        { provide: WorkflowExecutorService, useValue: executor },
      ],
    }).compile();
    const realRunner = module.get(WorkflowRunnerService);

    const wf = buildWorkflow({ conditions: {}, actions: [] });
    workflowRepo.find.mockResolvedValue([wf]);
    const ticket = buildTicket({ priority: 'urgent', channel: 'widget' }) as unknown as Ticket;

    await realRunner.runForEvent('ticket.created', ticket);

    expect(evalSpy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ priority: 'urgent', channel: 'widget' }),
    );
  });
});
