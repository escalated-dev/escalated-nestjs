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
  let ticketRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let inboundRepo: { save: jest.Mock };
  let createdTicket: Ticket | null;
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
    createdTicket = null;
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

    // Ticket repo: resolution lookups find nothing (new ticket), but a
    // `findOne({ where: { id: 101 } })` after save returns the created row
    // — that's how TicketService.create reloads at the end.
    ticketRepo = {
      findOne: jest.fn(async (query: { where?: { id?: number } }) => {
        if (createdTicket && query?.where?.id === createdTicket.id) {
          return createdTicket;
        }
        return null;
      }),
      create: jest.fn((data) => ({ ...data, id: 101, referenceNumber: 'TK-INT-1' }) as Ticket),
      save: jest.fn(async (t) => {
        createdTicket = Object.assign(Object.create(Ticket.prototype), t, { id: 101 });
        return createdTicket;
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
});
