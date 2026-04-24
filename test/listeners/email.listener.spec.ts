import { Test, TestingModule } from '@nestjs/testing';
import { EmailListener } from '../../src/listeners/email.listener';
import { EmailService } from '../../src/services/email/email.service';
import { ContactService } from '../../src/services/contact.service';
import {
  TicketCreatedEvent,
  TicketReplyCreatedEvent,
  TicketSignupInviteEvent,
} from '../../src/events/escalated.events';

describe('EmailListener', () => {
  let listener: EmailListener;
  let emailService: {
    sendTicketCreated: jest.Mock;
    sendReplyPosted: jest.Mock;
    sendSignupInvite: jest.Mock;
  };
  let contactService: { findById: jest.Mock };

  beforeEach(async () => {
    emailService = {
      sendTicketCreated: jest.fn().mockResolvedValue(undefined),
      sendReplyPosted: jest.fn().mockResolvedValue(undefined),
      sendSignupInvite: jest.fn().mockResolvedValue(undefined),
    };
    contactService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailListener,
        { provide: EmailService, useValue: emailService },
        { provide: ContactService, useValue: contactService },
      ],
    }).compile();

    listener = module.get(EmailListener);
  });

  describe('onTicketCreated', () => {
    it('sends a confirmation email when the ticket has a linked Contact', async () => {
      contactService.findById.mockResolvedValue({
        id: 42,
        email: 'alice@example.com',
        name: 'Alice',
      });
      const ticket = {
        id: 1,
        referenceNumber: 'TK-1',
        subject: 's',
        description: 'd',
        contactId: 42,
        guestAccessToken: 'tok',
      };

      await listener.onTicketCreated(new TicketCreatedEvent(ticket, 0));

      expect(contactService.findById).toHaveBeenCalledWith(42);
      expect(emailService.sendTicketCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          ticket: expect.objectContaining({ id: 1, referenceNumber: 'TK-1' }),
          contact: expect.objectContaining({ email: 'alice@example.com' }),
          guestAccessToken: 'tok',
        }),
      );
    });

    it('is a no-op when the ticket has no contactId', async () => {
      const ticket = { id: 1, contactId: null };
      await listener.onTicketCreated(new TicketCreatedEvent(ticket, 0));
      expect(contactService.findById).not.toHaveBeenCalled();
      expect(emailService.sendTicketCreated).not.toHaveBeenCalled();
    });

    it('is a no-op when the contact lookup returns null', async () => {
      contactService.findById.mockResolvedValue(null);
      const ticket = { id: 1, contactId: 42 };
      await listener.onTicketCreated(new TicketCreatedEvent(ticket, 0));
      expect(emailService.sendTicketCreated).not.toHaveBeenCalled();
    });

    it('swallows EmailService errors with a warn log (does not rethrow)', async () => {
      contactService.findById.mockResolvedValue({
        id: 42,
        email: 'alice@x.com',
        name: null,
      });
      emailService.sendTicketCreated.mockRejectedValue(new Error('mailer boom'));
      const ticket = { id: 1, contactId: 42, guestAccessToken: 'tok' };

      await expect(
        listener.onTicketCreated(new TicketCreatedEvent(ticket, 0)),
      ).resolves.toBeUndefined();
    });
  });

  describe('onReplyCreated', () => {
    it('sends the agent reply to the contact for external replies', async () => {
      contactService.findById.mockResolvedValue({
        id: 42,
        email: 'alice@example.com',
        name: 'Alice',
      });
      const ticket = {
        id: 1,
        referenceNumber: 'TK-1',
        subject: 's',
        contactId: 42,
        guestAccessToken: 'tok',
      };
      const reply = { id: 5, body: 'hi', isInternal: false, type: 'reply' };

      await listener.onReplyCreated(new TicketReplyCreatedEvent(reply, ticket, 7));

      expect(emailService.sendReplyPosted).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          reply: expect.objectContaining({ id: 5, body: 'hi' }),
        }),
      );
    });

    it('skips internal notes', async () => {
      const reply = { id: 5, body: 'internal', isInternal: true, type: 'note' };
      await listener.onReplyCreated(
        new TicketReplyCreatedEvent(reply, { id: 1, contactId: 42 }, 7),
      );
      expect(emailService.sendReplyPosted).not.toHaveBeenCalled();
    });

    it('skips when ticket has no contactId', async () => {
      const reply = { id: 5, body: 'hi', isInternal: false };
      await listener.onReplyCreated(
        new TicketReplyCreatedEvent(reply, { id: 1, contactId: null }, 7),
      );
      expect(emailService.sendReplyPosted).not.toHaveBeenCalled();
    });
  });

  describe('onSignupInvite', () => {
    it('dispatches sendSignupInvite with the resolved contact', async () => {
      contactService.findById.mockResolvedValue({
        id: 42,
        email: 'alice@example.com',
        name: 'Alice',
      });

      await listener.onSignupInvite(new TicketSignupInviteEvent(1, 42, 'alice@example.com'));

      expect(emailService.sendSignupInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          contact: expect.objectContaining({ id: 42 }),
        }),
      );
    });
  });
});
