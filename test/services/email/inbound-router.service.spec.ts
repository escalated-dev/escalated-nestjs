import { createHmac } from 'crypto';
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

function signedReplyTo(ticketId: number, secret = 'hunter2'): string {
  const sig = createHmac('sha256', secret).update(String(ticketId)).digest('hex').slice(0, 8);
  return `reply+${ticketId}.${sig}@reply.example.com`;
}

const REQUESTER_CONTACT = { id: 42, email: 'alice@example.com', userId: null };

describe('InboundRouterService', () => {
  let router: InboundRouterService;
  let contactService: { findOrCreateByEmail: jest.Mock; findByEmail: jest.Mock };
  let replyService: { create: jest.Mock };
  let ticketService: { create: jest.Mock };
  let ticketRepo: { findOne: jest.Mock };

  const signedOptions = {
    inbound: {
      replyDomain: 'reply.example.com',
      replySecret: 'hunter2',
      webhookSecret: 'whsec',
    },
  };

  // No reply secret: the unsigned header / subject paths stay available.
  const unsignedOptions = {
    inbound: {
      replyDomain: 'reply.example.com',
      replySecret: '',
      webhookSecret: 'whsec',
    },
  };

  async function buildRouter(options: unknown = signedOptions) {
    contactService = {
      findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 42, email: 'alice@example.com' }),
      findByEmail: jest.fn(async (email: string) => {
        const normalized = email.trim().toLowerCase();
        if (normalized === 'alice@example.com') return REQUESTER_CONTACT;
        if (normalized === 'bob@example.com') return { id: 43, email: normalized, userId: 7 };
        if (normalized === 'agent@example.com') return { id: 44, email: normalized, userId: 1 };
        return null;
      }),
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

  describe('with a reply secret: only the signed Reply-To identifies a ticket', () => {
    it('adds a reply when the signature verifies and the requester sent it', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 88, contactId: 42, requesterId: 0 });

      const result = await router.route(parsed({ to: signedReplyTo(88) }));

      expect(ticketRepo.findOne).toHaveBeenCalledWith({ where: { id: 88 } });
      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(88);
      expect(replyService.create).toHaveBeenCalledWith(
        88,
        expect.objectContaining({ body: 'body', type: 'reply' }),
        0,
      );
    });

    it('matches the requester address case-insensitively', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 88, contactId: 42, requesterId: 0 });

      const result = await router.route(
        parsed({ from: 'Alice@Example.COM', to: signedReplyTo(88) }),
      );

      expect(result.outcome).toBe('reply_added');
    });

    it('ignores a tampered signature (falls through to new-ticket path)', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 88, contactId: 42, requesterId: 0 });
      const result = await router.route(
        parsed({
          to: 'reply+88.deadbeef@reply.example.com',
          from: 'alice@example.com',
        }),
      );

      expect(replyService.create).not.toHaveBeenCalled();
      expect(result.outcome).toBe('ticket_created');
    });

    it('does not thread on In-Reply-To, References or a subject reference', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 55, contactId: 42, requesterId: 0 });

      const result = await router.route(
        parsed({
          subject: 'Re: [TK-ABC] thanks',
          inReplyTo: '<ticket-55@reply.example.com>',
          references: ['<ticket-55@reply.example.com>'],
        }),
      );

      expect(ticketRepo.findOne).not.toHaveBeenCalled();
      expect(replyService.create).not.toHaveBeenCalled();
      expect(result.outcome).toBe('ticket_created');
    });

    it('opens a new ticket for a stranger who carries the signed address', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 88, contactId: 42, requesterId: 0 });

      const result = await router.route(
        parsed({ from: 'mallory@example.com', fromName: 'Mallory', to: signedReplyTo(88) }),
      );

      expect(replyService.create).not.toHaveBeenCalled();
      expect(contactService.findOrCreateByEmail).toHaveBeenCalledWith(
        'mallory@example.com',
        'Mallory',
      );
      expect(result.outcome).toBe('ticket_created');
      expect(result.matchedTicketId).toBeUndefined();
    });
  });

  describe('without a reply secret: header and subject threading', () => {
    beforeEach(async () => {
      await buildRouter(unsignedOptions);
    });

    it('adds a reply on the In-Reply-To ticket', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 55, contactId: 42, requesterId: 0 });
      const result = await router.route(parsed({ inReplyTo: '<ticket-55@reply.example.com>' }));

      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(55);
      expect(replyService.create).toHaveBeenCalledWith(
        55,
        expect.objectContaining({ body: 'body', type: 'reply' }),
        0,
      );
    });

    it('also tries References chain when In-Reply-To has no hit', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 77, contactId: 42, requesterId: 0 });

      const result = await router.route(
        parsed({
          inReplyTo: '<unrelated@x.com>',
          references: ['<ticket-77@reply.example.com>'],
        }),
      );

      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(77);
    });

    it('adds a reply when the subject reference matches and the requester sent it', async () => {
      ticketRepo.findOne.mockResolvedValue({
        id: 123,
        referenceNumber: 'TK-ABC',
        contactId: 42,
        requesterId: 0,
      });
      const result = await router.route(parsed({ subject: 'Re: [TK-ABC] thanks' }));

      expect(ticketRepo.findOne).toHaveBeenCalledWith({
        where: { referenceNumber: 'TK-ABC' },
      });
      expect(result.outcome).toBe('reply_added');
      expect(result.matchedTicketId).toBe(123);
    });

    it('opens a new ticket for a stranger quoting a subject reference', async () => {
      ticketRepo.findOne.mockResolvedValue({
        id: 123,
        referenceNumber: 'TK-ABC',
        contactId: 42,
        requesterId: 0,
      });

      const result = await router.route(
        parsed({ from: 'mallory@example.com', fromName: 'Mallory', subject: 'Re: [TK-ABC] hi' }),
      );

      expect(replyService.create).not.toHaveBeenCalled();
      expect(ticketService.create).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Re: [TK-ABC] hi', channel: 'email', contactId: 42 }),
        0,
      );
      expect(result.outcome).toBe('ticket_created');
    });

    it('does not touch a closed ticket a stranger threads onto', async () => {
      ticketRepo.findOne.mockResolvedValue({
        id: 55,
        contactId: 42,
        requesterId: 0,
        status: 'closed',
        statusId: 5,
      });

      const result = await router.route(
        parsed({ from: 'mallory@example.com', inReplyTo: '<ticket-55@reply.example.com>' }),
      );

      // Only ticketService.create exists on the mock: any status change or
      // reply on ticket 55 would either throw or show up here.
      expect(replyService.create).not.toHaveBeenCalled();
      expect(result.outcome).toBe('ticket_created');
      expect(result.matchedTicketId).toBeUndefined();
    });

    it('never posts as an agent whose address is in From', async () => {
      // agent@example.com is linked to host user 1, an agent; the ticket's
      // requester is the guest contact 42.
      ticketRepo.findOne.mockResolvedValue({ id: 55, contactId: 42, requesterId: 0 });

      const result = await router.route(
        parsed({ from: 'agent@example.com', inReplyTo: '<ticket-55@reply.example.com>' }),
      );

      expect(replyService.create).not.toHaveBeenCalled();
      expect(result.outcome).toBe('ticket_created');
    });

    it('posts as the requester user when the sender is linked to them', async () => {
      // bob@example.com's contact is linked to host user 7, the requester.
      ticketRepo.findOne.mockResolvedValue({ id: 60, contactId: null, requesterId: 7 });

      const result = await router.route(
        parsed({ from: 'bob@example.com', inReplyTo: '<ticket-60@reply.example.com>' }),
      );

      expect(result.outcome).toBe('reply_added');
      expect(replyService.create).toHaveBeenCalledWith(60, expect.anything(), 7);
    });
  });

  describe('fallback creates a new ticket', () => {
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
