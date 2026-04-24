import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { InboundEmailController } from '../../src/controllers/inbound-email.controller';
import { InboundRouterService } from '../../src/services/email/inbound-router.service';
import { PostmarkInboundParser } from '../../src/services/email/postmark-parser.service';
import { ContactService } from '../../src/services/contact.service';
import { ReplyService } from '../../src/services/reply.service';
import { TicketService } from '../../src/services/ticket.service';
import { Contact } from '../../src/entities/contact.entity';
import { InboundEmail } from '../../src/entities/inbound-email.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { TicketStatus } from '../../src/entities/ticket-status.entity';
import { TicketActivity } from '../../src/entities/ticket-activity.entity';
import { Reply } from '../../src/entities/reply.entity';
import { AgentProfile } from '../../src/entities/agent-profile.entity';
import { ChatSession } from '../../src/entities/chat-session.entity';
import { TicketLink } from '../../src/entities/ticket-link.entity';
import { Tag } from '../../src/entities/tag.entity';
import { CustomFieldValue } from '../../src/entities/custom-field-value.entity';
import { ESCALATED_OPTIONS } from '../../src/config/escalated.config';

describe('integration: inbound email → Contact → Ticket → event', () => {
  let controller: InboundEmailController;
  let eventEmitter: EventEmitter2;
  let contactRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let ticketRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let replyRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let inboundRepo: { save: jest.Mock };
  let existingTickets: Map<number, Ticket>;
  let createdTicket: Ticket | null;
  let createdReply: Reply | null;
  let createdContact: Contact | null;

  // Minimal Postmark fixture — the parser accepts the "real" provider shape.
  const postmarkPayload = {
    From: 'alice@example.com',
    FromName: 'Alice',
    To: 'support@example.com',
    Subject: 'My laptop is on fire',
    TextBody: 'This is urgent — please help.',
    HtmlBody: '<p>This is urgent — please help.</p>',
    MessageID: 'external-abc@mail.alice.com',
    Headers: [{ Name: 'Message-ID', Value: '<external-abc@mail.alice.com>' }],
  };

  beforeEach(async () => {
    existingTickets = new Map();
    createdTicket = null;
    createdReply = null;
    createdContact = null;

    // Contact repo: not found by email, so findOrCreateByEmail creates one.
    contactRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => ({ ...data, id: 7 }) as Contact),
      save: jest.fn(async (c) => {
        createdContact = c as Contact;
        return createdContact;
      }),
    };

    // Ticket repo: resolution lookups find whatever's been pre-seeded via
    // `existingTickets`, and `findOne({ where: { id: 101 } })` after save
    // returns the created row — that's how TicketService.create reloads at
    // the end.
    ticketRepo = {
      findOne: jest.fn(async (query: { where?: { id?: number } }) => {
        const id = query?.where?.id;
        if (id === undefined) return null;
        if (createdTicket && id === createdTicket.id) return createdTicket;
        return existingTickets.get(id) ?? null;
      }),
      create: jest.fn((data) => ({ ...data, id: 101, referenceNumber: 'TK-INT-1' }) as Ticket),
      save: jest.fn(async (t) => {
        createdTicket = Object.assign(Object.create(Ticket.prototype), t, { id: 101 });
        return createdTicket;
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    replyRepo = {
      create: jest.fn((data) => ({ ...data, id: 42 }) as Reply),
      save: jest.fn(async (r) => {
        createdReply = Object.assign(Object.create(Reply.prototype), r, { id: 42 });
        return createdReply;
      }),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };

    inboundRepo = {
      save: jest.fn(async (row) => ({ id: 1, ...row })),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      controllers: [InboundEmailController],
      providers: [
        InboundRouterService,
        PostmarkInboundParser,
        ContactService,
        ReplyService,
        TicketService,
        { provide: ESCALATED_OPTIONS, useValue: { inbound: { provider: 'postmark' } } },
        { provide: getRepositoryToken(Contact), useValue: contactRepo },
        { provide: getRepositoryToken(InboundEmail), useValue: inboundRepo },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
        {
          provide: getRepositoryToken(TicketStatus),
          useValue: { findOne: jest.fn().mockResolvedValue({ id: 1, isDefault: true }) },
        },
        {
          provide: getRepositoryToken(TicketActivity),
          useValue: { save: jest.fn().mockResolvedValue({}) },
        },
        { provide: getRepositoryToken(Reply), useValue: replyRepo },
        {
          provide: getRepositoryToken(AgentProfile),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(ChatSession),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        { provide: getRepositoryToken(TicketLink), useValue: {} },
        {
          provide: getRepositoryToken(Tag),
          useValue: { findBy: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
        },
        { provide: getRepositoryToken(CustomFieldValue), useValue: {} },
      ],
    })
      // Bypass the signature guard — we test the guard separately.
      .overrideGuard(require('../../src/guards/inbound-webhook-signature.guard').InboundWebhookSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    await module.init();
    controller = module.get(InboundEmailController);
    eventEmitter = module.get(EventEmitter2);
  });

  it('creates a Contact, creates a Ticket, persists an audit row, and emits ticket.created', async () => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    eventEmitter.onAny((event, payload) => {
      emitted.push({ event: String(event), payload });
    });

    const result = await controller.receive(postmarkPayload);

    // Controller reports the happy-path outcome.
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('ticket_created');

    // A Contact was created for the sender.
    expect(contactRepo.findOne).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });
    expect(createdContact).toMatchObject({ email: 'alice@example.com', name: 'Alice' });

    // A Ticket was created with the parsed content + linked to the Contact.
    expect(createdTicket).toMatchObject({
      subject: 'My laptop is on fire',
      description: 'This is urgent — please help.',
      channel: 'email',
      contactId: 7,
    });

    // An InboundEmail audit row was persisted with the outcome.
    expect(inboundRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'postmark',
        parsedFrom: 'alice@example.com',
        parsedSubject: 'My laptop is on fire',
        outcome: 'ticket_created',
        createdTicketId: 101,
      }),
    );

    // escalated.ticket.created was emitted — this is the same bus the
    // WorkflowListener + EmailListener subscribe to, so this is what lets a
    // matching Workflow fire and the confirmation email go out.
    const ticketCreated = emitted.find((e) => e.event === 'escalated.ticket.created');
    expect(ticketCreated).toBeDefined();
    expect(ticketCreated?.payload).toMatchObject({ ticket: expect.objectContaining({ id: 101 }) });
  });

  it('ignores messages with no from address', async () => {
    const result = await controller.receive({
      ...postmarkPayload,
      From: '',
      Headers: [],
    });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('ignored');
    // No Contact or Ticket created.
    expect(contactRepo.save).not.toHaveBeenCalled();
    expect(ticketRepo.save).not.toHaveBeenCalled();
    // Audit row still written so operators can see what hit the webhook.
    expect(inboundRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'ignored' }),
    );
  });

  it('matches a canonical In-Reply-To to an existing ticket and adds a reply', async () => {
    // Seed a ticket that the inbound Message-ID will resolve to via
    // MessageIdUtil.parseTicketIdFromMessageId('<ticket-55@...>') → 55.
    existingTickets.set(
      55,
      Object.assign(Object.create(Ticket.prototype), {
        id: 55,
        referenceNumber: 'TK-55',
        requesterId: 0,
        firstRespondedAt: null,
      }) as Ticket,
    );

    const emitted: Array<{ event: string; payload: unknown }> = [];
    eventEmitter.onAny((event, payload) => {
      emitted.push({ event: String(event), payload });
    });

    const replyPayload = {
      ...postmarkPayload,
      Subject: 'Re: My laptop is on fire',
      TextBody: 'Thanks for the quick response — here is more detail.',
      HtmlBody: null,
      MessageID: 'external-reply-xyz@mail.alice.com',
      Headers: [
        { Name: 'Message-ID', Value: '<external-reply-xyz@mail.alice.com>' },
        { Name: 'In-Reply-To', Value: '<ticket-55@reply.example.com>' },
        { Name: 'References', Value: '<ticket-55@reply.example.com>' },
      ],
    };

    const result = await controller.receive(replyPayload);

    // Controller reports the reply-added outcome.
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('reply_added');

    // No new ticket created; the reply was appended to #55.
    expect(ticketRepo.save).not.toHaveBeenCalled();
    expect(replyRepo.save).toHaveBeenCalledTimes(1);
    expect(replyRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 55,
        body: 'Thanks for the quick response — here is more detail.',
        type: 'reply',
        isInternal: false,
      }),
    );

    // Contact was still upserted for the replying sender.
    expect(contactRepo.findOne).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });

    // Audit row records the matched ticket + reply ids.
    expect(inboundRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'reply_added',
        matchedTicketId: 55,
        createdReplyId: 42,
      }),
    );

    // escalated.ticket.reply_created fires (bus the EmailListener watches
    // to send the agent-side reply notification).
    const replyCreated = emitted.find(
      (e) => e.event === 'escalated.ticket.reply_created',
    );
    expect(replyCreated).toBeDefined();
    expect(replyCreated?.payload).toMatchObject({
      reply: expect.objectContaining({ id: 42, ticketId: 55 }),
    });
  });
});
