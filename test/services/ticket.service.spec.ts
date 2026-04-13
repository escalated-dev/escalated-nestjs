import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketService } from '../../src/services/ticket.service';
import { Ticket } from '../../src/entities/ticket.entity';
import { TicketStatus } from '../../src/entities/ticket-status.entity';
import { TicketActivity } from '../../src/entities/ticket-activity.entity';
import { Reply } from '../../src/entities/reply.entity';
import { AgentProfile } from '../../src/entities/agent-profile.entity';
import { ChatSession } from '../../src/entities/chat-session.entity';
import { Tag } from '../../src/entities/tag.entity';
import { CustomFieldValue } from '../../src/entities/custom-field-value.entity';
import { ESCALATED_EVENTS } from '../../src/events/escalated.events';

describe('TicketService', () => {
  let service: TicketService;
  let ticketRepo: any;
  let statusRepo: any;
  let activityRepo: any;
  let tagRepo: any;
  let eventEmitter: EventEmitter2;

  const mockTicket = {
    id: 1,
    referenceNumber: 'TK-ABC123',
    subject: 'Test ticket',
    description: 'Test description',
    priority: 'medium',
    channel: 'web',
    statusId: 1,
    requesterId: 1,
    assigneeId: null,
    isMerged: false,
    tags: [],
    status: { id: 1, name: 'Open', slug: 'open', isDefault: true, isClosed: false },
  };

  const mockStatus = { id: 1, name: 'Open', slug: 'open', isDefault: true, isClosed: false };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketService,
        {
          provide: getRepositoryToken(Ticket),
          useValue: {
            create: jest.fn().mockReturnValue(mockTicket),
            save: jest.fn().mockResolvedValue(mockTicket),
            findOne: jest.fn().mockResolvedValue(mockTicket),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockTicket),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[mockTicket], 1]),
            }),
          },
        },
        {
          provide: getRepositoryToken(TicketStatus),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockStatus),
          },
        },
        {
          provide: getRepositoryToken(TicketActivity),
          useValue: {
            save: jest.fn().mockResolvedValue({ id: 1 }),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(Reply),
          useValue: {
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
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(ChatSession),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(Tag),
          useValue: {
            findBy: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(CustomFieldValue),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockResolvedValue({ id: 1 }),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TicketService>(TicketService);
    ticketRepo = module.get(getRepositoryToken(Ticket));
    statusRepo = module.get(getRepositoryToken(TicketStatus));
    activityRepo = module.get(getRepositoryToken(TicketActivity));
    tagRepo = module.get(getRepositoryToken(Tag));
    eventEmitter = module.get(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a ticket with default status', async () => {
      const dto = { subject: 'Test', description: 'Desc' };
      const result = await service.create(dto, 1);

      expect(ticketRepo.create).toHaveBeenCalled();
      expect(ticketRepo.save).toHaveBeenCalled();
      expect(activityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'created' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.TICKET_CREATED,
        expect.anything(),
      );
      expect(result).toBeDefined();
    });

    it('should create a ticket with custom priority', async () => {
      const dto = { subject: 'Urgent', description: 'Help!', priority: 'urgent' as const };
      await service.create(dto, 1);

      expect(ticketRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'urgent' }),
      );
    });

    it('should handle tags during creation', async () => {
      tagRepo.findBy.mockResolvedValue([{ id: 1, name: 'Bug' }]);
      const dto = { subject: 'Bug', description: 'A bug', tagIds: [1] };
      await service.create(dto, 1);

      expect(tagRepo.findBy).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a ticket by ID', async () => {
      const result = await service.findById(1);
      expect(result).toEqual(mockTicket);
      expect(ticketRepo.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['status', 'department', 'tags'],
      });
    });

    it('should throw NotFoundException for missing ticket', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      await expect(service.findById(999)).rejects.toThrow('not found');
    });
  });

  describe('findAll', () => {
    it('should return paginated tickets', async () => {
      const result = await service.findAll({ page: 1, perPage: 25 });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should apply filters', async () => {
      const qb = ticketRepo.createQueryBuilder();
      await service.findAll({ priority: 'high', statusId: 1 });
      expect(qb.andWhere).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update ticket fields', async () => {
      const dto = { subject: 'Updated subject' };
      const result = await service.update(1, dto, 1);

      expect(ticketRepo.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should emit status change event', async () => {
      statusRepo.findOne.mockResolvedValue({ id: 2, isClosed: false });
      const dto = { statusId: 2 };
      await service.update(1, dto, 1);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.TICKET_STATUS_CHANGED,
        expect.anything(),
      );
    });

    it('should emit assignment event', async () => {
      const dto = { assigneeId: 5 };
      await service.update(1, dto, 1);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.TICKET_ASSIGNED,
        expect.anything(),
      );
    });
  });

  describe('merge', () => {
    it('should merge two tickets', async () => {
      const target = { ...mockTicket, id: 2, referenceNumber: 'TK-DEF456' };
      ticketRepo.findOne
        .mockResolvedValueOnce(mockTicket)
        .mockResolvedValueOnce(target)
        .mockResolvedValue(target);

      await service.merge(1, 2, 1);

      expect(ticketRepo.update).toHaveBeenCalledWith(1, {
        isMerged: true,
        mergedIntoTicketId: 2,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.TICKET_MERGED,
        expect.anything(),
      );
    });

    it('should reject self-merge', async () => {
      await expect(service.merge(1, 1, 1)).rejects.toThrow('Cannot merge a ticket into itself');
    });
  });

  describe('split', () => {
    it('should split a ticket', async () => {
      const result = await service.split(1, [], 1);

      expect(result).toBeDefined();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.TICKET_SPLIT,
        expect.anything(),
      );
    });
  });

  describe('delete', () => {
    it('should delete a ticket', async () => {
      await service.delete(1);
      expect(ticketRepo.remove).toHaveBeenCalledWith(mockTicket);
    });
  });
});
