import { Test, TestingModule } from '@nestjs/testing';
import { InboundRouterService } from '../../../src/services/email/inbound-router.service';
import { ContactService } from '../../../src/services/contact.service';
import { ReplyService } from '../../../src/services/reply.service';
import { TicketService } from '../../../src/services/ticket.service';
import { ESCALATED_OPTIONS } from '../../../src/config/escalated.config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Ticket } from '../../../src/entities/ticket.entity';
import type { ParsedInboundEmail } from '../../../src/services/email/inbound-parser.interface';

function parsed(over: Partial<ParsedInboundEmail> = {}): ParsedInboundEmail {
  return {
    from: 'alice@example.com',
    fromName: 'Alice',
    to: 'support@example.com',
    subject: 'hi',
    textBody: 'body',
    htmlBody: null,
    messageId: null,
    inReplyTo: null,
    references: [],
    ...over,
  };
}

describe('InboundRouterService', () => {
  let router: InboundRouterService;
  let contactService: { findOrCreateByEmail: jest.Mock };
  let replyService: { create: jest.Mock };
  let ticketService: { create: jest.Mock };
  let ticketRepo: { findOne: jest.Mock };

  const baseOptions = {
    inbound: {
      replyDomain: 'reply.example.com',
      replySecret: 'hunter2',
      webhookSecret: 'whsec',
    },
  };

  async function buildRouter(options = baseOptions) {
    contactService = {
      findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 42, email: 'alice@example.com' }),
    };
    replyService = {
      create: jest.fn().mockResolvedValue({ id: 99, body: 'body' }),
    };
    ticketService = {
      create: jest.fn().mockResolvedValue({ id: 500, referenceNumber: 'TK-NEW' }),
    };
    ticketRepo = {
      findOne: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        InboundRouterService,
        { provide: ContactService, useValue: contactService },
        { provide: ReplyService, useValue: replyService },
        { provide: TicketService, useValue: ticketService },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
        { provide: ESCALATED_OPTIONS, useValue: options },
      ],
    }).compile();

    router = moduleRef.get(InboundRouterService);
  }

  beforeEach(async () => {
    await buildRouter();
  });

  describe('priority 1: In-Reply-To matches our Message-ID', () => {
    it('adds a reply on the referenced ticket', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 55, contactId: 42 });
      const result = await router.route(
        parsed({ inReplyTo: '<ticket-55@reply.example.com>' }),
      );

      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(55);
      expect(replyService.create).toHaveBeenCalledWith(
        55,
        expect.objectContaining({ body: 'body', type: 'reply' }),
        0,
      );
    });

    it('also tries References chain when In-Reply-To has no hit', async () => {
      // inReplyTo is unparseable (not our format) → no DB call for it.
      // First DB call is for the References entry → returns the ticket.
      ticketRepo.findOne.mockResolvedValue({ id: 77 });

      const result = await router.route(
        parsed({
          inReplyTo: '<unrelated@x.com>',
          references: ['<ticket-77@reply.example.com>'],
        }),
      );

      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(77);
    });
  });

  describe('priority 2: To address is a signed reply-to', () => {
    it('adds a reply when the signature verifies', async () => {
      // Build a valid signed reply-to for ticket 88 with the same secret
      const { createHmac } = await import('crypto');
      const sig = createHmac('sha256', 'hunter2')
        .update('88')
        .digest('hex')
        .slice(0, 8);
      ticketRepo.findOne.mockResolvedValue({ id: 88 });

      const result = await router.route(
        parsed({ to: `reply+88.${sig}@reply.example.com` }),
      );

      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(88);
    });

    it('ignores a tampered signature (falls through to new-ticket path)', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      const result = await router.route(
        parsed({
          to: 'reply+88.deadbeef@reply.example.com',
          from: 'alice@example.com',
        }),
      );

      expect(replyService.create).not.toHaveBeenCalled();
      expect(result.outcome).toBe('ticket_created');
    });
  });

  describe('priority 3: subject contains reference number', () => {
    it('adds a reply when ticket by reference is found', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 123, referenceNumber: 'TK-ABC' });
      const result = await router.route(parsed({ subject: 'Re: [TK-ABC] thanks' }));

      expect(ticketRepo.findOne).toHaveBeenCalledWith({
        where: { referenceNumber: 'TK-ABC' },
      });
      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(123);
    });
  });

  describe('priority 4: fallback creates a new ticket', () => {
    it('resolves/creates a Contact and creates a new ticket', async () => {
      ticketRepo.findOne.mockResolvedValue(null);

      const result = await router.route(
        parsed({
          from: 'new@user.com',
          fromName: 'New',
          subject: 'Hello',
          textBody: 'body here',
        }),
      );

      expect(contactService.findOrCreateByEmail).toHaveBeenCalledWith('new@user.com', 'New');
      expect(ticketService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Hello',
          description: 'body here',
          channel: 'email',
          contactId: 42,
        }),
        0,
      );
      expect(result.outcome).toBe('ticket_created');
      expect(result.createdTicketId).toBe(500);
    });

    it('uses a placeholder subject if the incoming subject is empty', async () => {
      ticketRepo.findOne.mockResolvedValue(null);

      await router.route(parsed({ subject: '', textBody: 'body' }));

      expect(ticketService.create).toHaveBeenCalledWith(
        expect.objectContaining({ subject: '(no subject)' }),
        0,
      );
    });
  });

  describe('ignores malformed inputs', () => {
    it('returns ignored when from address is missing', async () => {
      const result = await router.route(parsed({ from: '' }));
      expect(result.outcome).toBe('ignored');
      expect(ticketService.create).not.toHaveBeenCalled();
    });
  });
});
