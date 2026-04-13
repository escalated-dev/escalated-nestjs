import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReplyService } from '../../src/services/reply.service';
import { Reply } from '../../src/entities/reply.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { TicketActivity } from '../../src/entities/ticket-activity.entity';
import { ESCALATED_EVENTS } from '../../src/events/escalated.events';

describe('ReplyService', () => {
  let service: ReplyService;
  let replyRepo: any;
  let ticketRepo: any;
  let eventEmitter: EventEmitter2;

  const mockTicket = {
    id: 1,
    referenceNumber: 'TK-ABC',
    requesterId: 1,
    firstRespondedAt: null,
  };

  const mockReply = {
    id: 1,
    ticketId: 1,
    userId: 2,
    body: 'Test reply',
    type: 'reply',
    isInternal: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplyService,
        {
          provide: getRepositoryToken(Reply),
          useValue: {
            create: jest.fn().mockReturnValue(mockReply),
            save: jest.fn().mockResolvedValue(mockReply),
            findOne: jest.fn().mockResolvedValue(mockReply),
            find: jest.fn().mockResolvedValue([mockReply]),
            remove: jest.fn().mockResolvedValue(mockReply),
          },
        },
        {
          provide: getRepositoryToken(Ticket),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockTicket),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(TicketActivity),
          useValue: {
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

    service = module.get<ReplyService>(ReplyService);
    replyRepo = module.get(getRepositoryToken(Reply));
    ticketRepo = module.get(getRepositoryToken(Ticket));
    eventEmitter = module.get(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a reply', async () => {
      const result = await service.create(1, { body: 'Test reply' }, 2);

      expect(replyRepo.create).toHaveBeenCalled();
      expect(replyRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.TICKET_REPLY_CREATED,
        expect.anything(),
      );
      expect(result).toEqual(mockReply);
    });

    it('should track first response for SLA', async () => {
      await service.create(1, { body: 'Agent reply' }, 2);

      expect(ticketRepo.update).toHaveBeenCalledWith(1, {
        firstRespondedAt: expect.any(Date),
      });
    });

    it('should not track first response for internal notes', async () => {
      await service.create(1, { body: 'Internal note', isInternal: true }, 2);

      expect(ticketRepo.update).not.toHaveBeenCalled();
    });

    it('should throw for missing ticket', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      await expect(service.create(999, { body: 'Test' }, 1)).rejects.toThrow('not found');
    });
  });

  describe('findByTicketId', () => {
    it('should return all replies including internal', async () => {
      const result = await service.findByTicketId(1, true);
      expect(result).toHaveLength(1);
      expect(replyRepo.find).toHaveBeenCalledWith({
        where: { ticketId: 1 },
        relations: ['attachments'],
        order: { createdAt: 'ASC' },
      });
    });

    it('should exclude internal replies', async () => {
      await service.findByTicketId(1, false);
      expect(replyRepo.find).toHaveBeenCalledWith({
        where: { ticketId: 1, isInternal: false },
        relations: ['attachments'],
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('delete', () => {
    it('should delete a reply', async () => {
      await service.delete(1);
      expect(replyRepo.remove).toHaveBeenCalledWith(mockReply);
    });
  });
});
