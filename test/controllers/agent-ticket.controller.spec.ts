import { Test, TestingModule } from '@nestjs/testing';
import { AgentTicketController } from '../../src/controllers/agent/ticket.controller';
import { TicketService } from '../../src/services/ticket.service';
import { ReplyService } from '../../src/services/reply.service';
import { AuditLogInterceptor } from '../../src/interceptors/audit-log.interceptor';
import { Reflector } from '@nestjs/core';

describe('AgentTicketController', () => {
  let controller: AgentTicketController;
  let ticketService: any;
  let replyService: any;

  const mockTicket = {
    id: 1,
    referenceNumber: 'TK-ABC',
    subject: 'Test',
    description: 'Desc',
    priority: 'medium',
    status: { id: 1, name: 'Open' },
    tags: [],
  };

  const mockReply = { id: 1, ticketId: 1, body: 'Reply', type: 'reply' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentTicketController],
      providers: [
        {
          provide: TicketService,
          useValue: {
            findAll: jest.fn().mockResolvedValue({ data: [mockTicket], total: 1 }),
            findById: jest.fn().mockResolvedValue(mockTicket),
            create: jest.fn().mockResolvedValue(mockTicket),
            update: jest.fn().mockResolvedValue(mockTicket),
            delete: jest.fn().mockResolvedValue(undefined),
            merge: jest.fn().mockResolvedValue(mockTicket),
            split: jest.fn().mockResolvedValue(mockTicket),
            unsnooze: jest.fn().mockResolvedValue(undefined),
            getActivities: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ReplyService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockReply),
            findByTicketId: jest.fn().mockResolvedValue([mockReply]),
          },
        },
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    })
      .overrideInterceptor(AuditLogInterceptor)
      .useValue({ intercept: (_, next) => next.handle() })
      .compile();

    controller = module.get<AgentTicketController>(AgentTicketController);
    ticketService = module.get(TicketService);
    replyService = module.get(ReplyService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('index', () => {
    it('should return paginated tickets', async () => {
      const result = await controller.index({ page: 1 });
      expect(result.data).toHaveLength(1);
      expect(ticketService.findAll).toHaveBeenCalled();
    });
  });

  describe('show', () => {
    it('should return ticket with replies and activities', async () => {
      const result = await controller.show(1);
      expect(result.ticket).toEqual(mockTicket);
      expect(result.replies).toBeDefined();
      expect(result.activities).toBeDefined();
    });
  });

  describe('create', () => {
    it('should create a ticket', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.create(
        { subject: 'Test', description: 'Desc' },
        req,
      );
      expect(result).toEqual(mockTicket);
    });
  });

  describe('update', () => {
    it('should update a ticket', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.update(1, { priority: 'high' }, req);
      expect(result).toEqual(mockTicket);
    });
  });

  describe('merge', () => {
    it('should merge tickets', async () => {
      const req = { user: { id: 1 } };
      await controller.merge(1, 2, req);
      expect(ticketService.merge).toHaveBeenCalledWith(1, 2, 1);
    });
  });

  describe('split', () => {
    it('should split a ticket', async () => {
      const req = { user: { id: 1 } };
      await controller.split(1, [2, 3], req);
      expect(ticketService.split).toHaveBeenCalledWith(1, [2, 3], 1);
    });
  });

  describe('addReply', () => {
    it('should add a reply', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.addReply(1, { body: 'Reply' }, req);
      expect(result).toEqual(mockReply);
    });
  });
});
