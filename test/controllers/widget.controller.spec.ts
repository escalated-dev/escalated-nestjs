import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WidgetController } from '../../src/controllers/widget/widget.controller';
import { TicketService } from '../../src/services/ticket.service';
import { ReplyService } from '../../src/services/reply.service';
import { KnowledgeBaseService } from '../../src/services/knowledge-base.service';
import { SatisfactionRatingService } from '../../src/services/satisfaction-rating.service';

import { Ticket } from '../../src/entities/ticket.entity';

describe('WidgetController', () => {
  let controller: WidgetController;
  let ticketService: any;

  const mockTicket = {
    id: 1,
    referenceNumber: 'TK-ABC',
    subject: 'Widget Ticket',
    guestAccessToken: 'abc-123',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WidgetController],
      providers: [
        {
          provide: getRepositoryToken(Ticket),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: TicketService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockTicket),
            findById: jest.fn().mockResolvedValue(mockTicket),
          },
        },
        {
          provide: ReplyService,
          useValue: {
            findByTicketId: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ id: 1, body: 'Reply' }),
          },
        },
        {
          provide: KnowledgeBaseService,
          useValue: {
            searchArticles: jest.fn().mockResolvedValue([]),
            findArticleBySlug: jest.fn().mockResolvedValue({ id: 1, title: 'Article' }),
          },
        },
        {
          provide: SatisfactionRatingService,
          useValue: {
            findByToken: jest.fn().mockResolvedValue({ id: 1, rating: 5 }),
            submitByToken: jest.fn().mockResolvedValue({ id: 1, rating: 4 }),
          },
        },
      ],
    }).compile();

    controller = module.get<WidgetController>(WidgetController);
    ticketService = module.get(TicketService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createTicket', () => {
    it('should create a widget ticket', async () => {
      const result = await controller.createTicket({
        subject: 'Help',
        description: 'I need help',
        requesterId: 1,
      });

      expect(result.ticket).toEqual(mockTicket);
      expect(result.guestAccessToken).toBe('abc-123');
      expect(ticketService.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'widget' }),
        1,
      );
    });
  });

  describe('searchKb', () => {
    it('should search knowledge base', async () => {
      const result = await controller.searchKb('help');
      expect(result).toEqual([]);
    });

    it('should return empty for no query', async () => {
      const result = await controller.searchKb('');
      expect(result).toEqual([]);
    });
  });

  describe('submitRating', () => {
    it('should submit CSAT rating', async () => {
      const result = await controller.submitRating('token-123', { rating: 4, comment: 'Good' });
      expect(result.rating).toBe(4);
    });
  });
});
