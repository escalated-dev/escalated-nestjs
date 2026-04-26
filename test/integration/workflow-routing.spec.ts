import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { TicketService } from '../../src/services/ticket.service';
import { WorkflowListener } from '../../src/listeners/workflow.listener';
import { WorkflowRunnerService } from '../../src/services/workflow-runner.service';
import { WorkflowEngineService } from '../../src/services/workflow-engine.service';
import { WorkflowExecutorService } from '../../src/services/workflow-executor.service';
import { Ticket } from '../../src/entities/ticket.entity';
import { TicketStatus } from '../../src/entities/ticket-status.entity';
import { TicketActivity } from '../../src/entities/ticket-activity.entity';
import { Reply } from '../../src/entities/reply.entity';
import { AgentProfile } from '../../src/entities/agent-profile.entity';
import { ChatSession } from '../../src/entities/chat-session.entity';
import { TicketLink } from '../../src/entities/ticket-link.entity';
import { Tag } from '../../src/entities/tag.entity';
import { CustomFieldValue } from '../../src/entities/custom-field-value.entity';
import { Workflow } from '../../src/entities/workflow.entity';
import { WorkflowLog } from '../../src/entities/workflow-log.entity';
import { buildWorkflow } from '../factories';

describe('integration: TicketService.create → Workflow routing', () => {
  let ticketService: TicketService;
  let executorMock: { execute: jest.Mock };
  let workflowRepo: any;
  let logRepo: any;

  const mockTicket = {
    id: 10,
    referenceNumber: 'TK-INT',
    subject: 's',
    description: 'd',
    priority: 'medium',
    channel: 'widget',
    statusId: 1,
    requesterId: 0,
    contactId: null,
    assigneeId: null,
    tags: [],
  };

  beforeEach(async () => {
    executorMock = { execute: jest.fn().mockResolvedValue(undefined) };
    workflowRepo = { find: jest.fn() };
    logRepo = {
      save: jest.fn(async (x) => ({ id: 1, ...x })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        TicketService,
        WorkflowListener,
        WorkflowRunnerService,
        WorkflowEngineService,
        { provide: WorkflowExecutorService, useValue: executorMock },
        {
          provide: getRepositoryToken(Ticket),
          useValue: {
            create: jest.fn().mockReturnValue(mockTicket),
            save: jest.fn().mockResolvedValue(mockTicket),
            findOne: jest.fn().mockResolvedValue(mockTicket),
          },
        },
        {
          provide: getRepositoryToken(TicketStatus),
          useValue: { findOne: jest.fn().mockResolvedValue({ id: 1, isDefault: true }) },
        },
        {
          provide: getRepositoryToken(TicketActivity),
          useValue: { save: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: getRepositoryToken(Reply),
          useValue: {
            save: jest.fn(),
            findOne: jest.fn().mockResolvedValue(null),
            createQueryBuilder: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            }),
          },
        },
        {
          provide: getRepositoryToken(AgentProfile),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(ChatSession),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(TicketLink),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Tag),
          useValue: { findBy: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(CustomFieldValue),
          useValue: {},
        },
        { provide: getRepositoryToken(Workflow), useValue: workflowRepo },
        { provide: getRepositoryToken(WorkflowLog), useValue: logRepo },
      ],
    }).compile();

    await module.init();
    ticketService = module.get(TicketService);
  });

  it('fires a matching Workflow on ticket.created end-to-end', async () => {
    // Single active workflow: on ticket.created, assign to agent 5
    workflowRepo.find.mockResolvedValue([
      buildWorkflow({
        id: 1,
        triggerEvent: 'ticket.created',
        conditions: {},
        actions: [{ type: 'assign_agent', value: '5' }],
      }),
    ]);

    await ticketService.create({ subject: 's', description: 'd', channel: 'widget' }, 0);

    // Give the async event listener a tick to run
    await new Promise((r) => setImmediate(r));

    expect(workflowRepo.find).toHaveBeenCalledWith({
      where: { triggerEvent: 'ticket.created', isActive: true },
      order: { position: 'ASC' },
    });
    expect(executorMock.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }), [
      { type: 'assign_agent', value: '5' },
    ]);
    expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ conditionsMatched: true }));
  });

  it('does not execute when no workflows match the trigger', async () => {
    workflowRepo.find.mockResolvedValue([]);

    await ticketService.create({ subject: 's', description: 'd', channel: 'widget' }, 0);
    await new Promise((r) => setImmediate(r));

    expect(executorMock.execute).not.toHaveBeenCalled();
    expect(logRepo.save).not.toHaveBeenCalled();
  });

  it('skips non-matching workflows but still logs them', async () => {
    workflowRepo.find.mockResolvedValue([
      buildWorkflow({
        id: 2,
        conditions: { all: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
        actions: [{ type: 'change_priority', value: 'urgent' }],
      }),
    ]);

    await ticketService.create(
      { subject: 's', description: 'd', priority: 'low', channel: 'widget' },
      0,
    );
    await new Promise((r) => setImmediate(r));

    expect(executorMock.execute).not.toHaveBeenCalled();
    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ conditionsMatched: false }),
    );
  });
});
