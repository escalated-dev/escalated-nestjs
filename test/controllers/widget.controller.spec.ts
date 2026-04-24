import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { WidgetController } from '../../src/controllers/widget/widget.controller';
import { TicketService } from '../../src/services/ticket.service';
import { ReplyService } from '../../src/services/reply.service';
import { KnowledgeBaseService } from '../../src/services/knowledge-base.service';
import { SatisfactionRatingService } from '../../src/services/satisfaction-rating.service';
import { ContactService } from '../../src/services/contact.service';
import { ESCALATED_OPTIONS } from '../../src/config/escalated.config';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { ESCALATED_EVENTS } from '../../src/events/escalated.events';

import { Ticket } from '../../src/entities/ticket.entity';

interface MockedModule {
  controller: WidgetController;
  ticketService: { create: jest.Mock; findById: jest.Mock };
  contactService: { findOrCreateByEmail: jest.Mock };
  eventEmitter: { emit: jest.Mock };
}

async function buildModule(
  policy?: EscalatedModuleOptions['guestPolicy'],
): Promise<MockedModule> {
  const mockTicket = {
    id: 1,
    referenceNumber: 'TK-ABC',
    subject: 'Widget Ticket',
    guestAccessToken: 'abc-123',
  };

  const ticketService = {
    create: jest.fn().mockResolvedValue(mockTicket),
    findById: jest.fn().mockResolvedValue(mockTicket),
  };

  const contactService = {
    findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 42, email: 'alice@x.com' }),
  };

  const eventEmitter = { emit: jest.fn() };

  const options: EscalatedModuleOptions = policy ? { guestPolicy: policy } : {};

  const module: TestingModule = await Test.createTestingModule({
    controllers: [WidgetController],
    providers: [
      { provide: getRepositoryToken(Ticket), useValue: { findOne: jest.fn() } },
      { provide: TicketService, useValue: ticketService },
      { provide: ContactService, useValue: contactService },
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
      { provide: ESCALATED_OPTIONS, useValue: options },
      { provide: EventEmitter2, useValue: eventEmitter },
    ],
  }).compile();

  return {
    controller: module.get(WidgetController),
    ticketService,
    contactService,
    eventEmitter,
  };
}

describe('WidgetController', () => {
  it('should be defined', async () => {
    const { controller } = await buildModule();
    expect(controller).toBeDefined();
  });

  describe('createTicket (public email path)', () => {
    it('resolves a Contact by email and passes contactId to TicketService', async () => {
      const { controller, ticketService, contactService } = await buildModule();

      const result = await controller.createTicket({
        email: 'alice@x.com',
        name: 'Alice',
        subject: 'Help',
        description: 'd',
      });

      expect(contactService.findOrCreateByEmail).toHaveBeenCalledWith('alice@x.com', 'Alice');
      expect(ticketService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'widget',
          subject: 'Help',
          description: 'd',
          contactId: 42,
        }),
        0,
      );
      expect(result.guestAccessToken).toBe('abc-123');
    });

    it('passes name as null when the submitter omits it', async () => {
      const { controller, contactService } = await buildModule();

      await controller.createTicket({
        email: 'alice@x.com',
        subject: 'Help',
        description: 'd',
      });

      expect(contactService.findOrCreateByEmail).toHaveBeenCalledWith('alice@x.com', undefined);
    });
  });

  describe('createTicket (legacy requesterId path)', () => {
    it('does NOT resolve a Contact when only requesterId is given', async () => {
      const { controller, ticketService, contactService } = await buildModule();

      await controller.createTicket({
        requesterId: 17,
        subject: 'Help',
        description: 'd',
      });

      expect(contactService.findOrCreateByEmail).not.toHaveBeenCalled();
      expect(ticketService.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'widget' }),
        17,
      );
    });

    it('rejects when neither email nor requesterId is supplied', async () => {
      const { controller } = await buildModule();

      await expect(
        controller.createTicket({ subject: 'Help', description: 'd' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createTicket (guest policy)', () => {
    it('mode=unassigned leaves requesterId=0', async () => {
      const { controller, ticketService } = await buildModule({ mode: 'unassigned' });

      await controller.createTicket({
        email: 'a@b.com',
        subject: 's',
        description: 'd',
      });

      expect(ticketService.create).toHaveBeenCalledWith(expect.anything(), 0);
    });

    it('mode=guest_user uses the configured guestUserId as requesterId', async () => {
      const { controller, ticketService } = await buildModule({
        mode: 'guest_user',
        guestUserId: 99,
      });

      await controller.createTicket({
        email: 'a@b.com',
        subject: 's',
        description: 'd',
      });

      expect(ticketService.create).toHaveBeenCalledWith(expect.anything(), 99);
    });

    it('mode=prompt_signup leaves requesterId=0 and emits a signup invite event', async () => {
      const { controller, ticketService, eventEmitter } = await buildModule({
        mode: 'prompt_signup',
      });

      await controller.createTicket({
        email: 'a@b.com',
        name: 'Alice',
        subject: 's',
        description: 'd',
      });

      expect(ticketService.create).toHaveBeenCalledWith(expect.anything(), 0);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.SIGNUP_INVITE,
        expect.objectContaining({ contactId: 42 }),
      );
    });

    it('defaults to unassigned when no policy is configured', async () => {
      const { controller, ticketService } = await buildModule();

      await controller.createTicket({
        email: 'a@b.com',
        subject: 's',
        description: 'd',
      });

      expect(ticketService.create).toHaveBeenCalledWith(expect.anything(), 0);
    });
  });

  describe('searchKb', () => {
    it('should search knowledge base', async () => {
      const { controller } = await buildModule();
      const result = await controller.searchKb('help');
      expect(result).toEqual([]);
    });

    it('should return empty for no query', async () => {
      const { controller } = await buildModule();
      const result = await controller.searchKb('');
      expect(result).toEqual([]);
    });
  });

  describe('submitRating', () => {
    it('should submit CSAT rating', async () => {
      const { controller } = await buildModule();
      const result = await controller.submitRating('token-123', { rating: 4, comment: 'Good' });
      expect(result.rating).toBe(4);
    });
  });
});
