import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatSessionService } from '../../src/services/chat-session.service';
import { ChatRoutingService } from '../../src/services/chat-routing.service';
import { TicketService } from '../../src/services/ticket.service';
import { ReplyService } from '../../src/services/reply.service';
import { ChatSession } from '../../src/entities/chat-session.entity';
import { ChatRoutingRule } from '../../src/entities/chat-routing-rule.entity';
import { ESCALATED_EVENTS } from '../../src/events/escalated.events';

describe('ChatSessionService', () => {
  let service: ChatSessionService;
  let chatSessionRepo: any;
  let ticketService: any;
  let replyService: any;
  let _routingService: ChatRoutingService;
  let eventEmitter: EventEmitter2;

  const mockSession = {
    id: 1,
    ticketId: 1,
    visitorName: 'Visitor',
    visitorEmail: 'v@test.com',
    status: 'waiting',
    agentId: null,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTicket = {
    id: 1,
    referenceNumber: 'TK-001',
    subject: 'Chat with Visitor',
    description: 'Hello',
    channel: 'chat',
    guestAccessToken: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatSessionService,
        ChatRoutingService,
        {
          provide: getRepositoryToken(ChatSession),
          useValue: {
            create: jest.fn().mockReturnValue(mockSession),
            save: jest.fn().mockResolvedValue(mockSession),
            findOne: jest.fn().mockResolvedValue(mockSession),
            find: jest.fn().mockResolvedValue([mockSession]),
            count: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: getRepositoryToken(ChatRoutingRule),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: TicketService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockTicket),
          },
        },
        {
          provide: ReplyService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 1, body: 'Hello', ticketId: 1 }),
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

    service = module.get<ChatSessionService>(ChatSessionService);
    chatSessionRepo = module.get(getRepositoryToken(ChatSession));
    ticketService = module.get(TicketService);
    replyService = module.get(ReplyService);
    _routingService = module.get(ChatRoutingService);
    eventEmitter = module.get(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('start', () => {
    it('should create a session and ticket', async () => {
      const session = await service.start('Visitor', 'v@test.com', 'Hello');

      expect(ticketService.create).toHaveBeenCalled();
      expect(chatSessionRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.CHAT_STARTED,
        expect.any(Object),
      );
      expect(session.visitorName).toBe('Visitor');
    });
  });

  describe('accept', () => {
    it('should transition to active', async () => {
      const activeSession = { ...mockSession, status: 'active', agentId: 42 };
      chatSessionRepo.save.mockResolvedValue(activeSession);

      await service.accept(1, 42);

      expect(chatSessionRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.CHAT_ACCEPTED,
        expect.objectContaining({ agentId: 42 }),
      );
    });

    it('should throw for non-waiting session', async () => {
      chatSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        status: 'active',
      });

      await expect(service.accept(1, 42)).rejects.toThrow(
        'Chat session is not in a waiting state.',
      );
    });
  });

  describe('sendMessage', () => {
    it('should create a reply', async () => {
      chatSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        status: 'active',
      });

      await service.sendMessage(1, 'Hello', undefined, 'visitor');

      expect(replyService.create).toHaveBeenCalledWith(1, { body: 'Hello', type: 'reply' }, 0);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.CHAT_MESSAGE,
        expect.any(Object),
      );
    });

    it('should throw for ended session', async () => {
      chatSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        status: 'ended',
      });

      await expect(service.sendMessage(1, 'msg', undefined, 'visitor')).rejects.toThrow(
        'Chat session has ended.',
      );
    });
  });

  describe('end', () => {
    it('should transition to ended', async () => {
      const endedSession = {
        ...mockSession,
        status: 'ended',
        endedAt: new Date(),
      };
      chatSessionRepo.save.mockResolvedValue(endedSession);

      await service.end(1);

      expect(chatSessionRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.CHAT_ENDED,
        expect.any(Object),
      );
    });

    it('should throw for already ended session', async () => {
      chatSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        status: 'ended',
      });

      await expect(service.end(1)).rejects.toThrow('Chat session has already ended.');
    });
  });

  describe('getWaitingSessions', () => {
    it('should return waiting sessions', async () => {
      const result = await service.getWaitingSessions();
      expect(result).toHaveLength(1);
    });
  });

  describe('getQueueDepth', () => {
    it('should return count', async () => {
      const result = await service.getQueueDepth();
      expect(result).toBe(1);
    });
  });
});
