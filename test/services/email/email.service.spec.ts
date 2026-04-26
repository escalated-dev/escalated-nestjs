import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from '@nestjs-modules/mailer';
import { EmailService } from '../../../src/services/email/email.service';
import { ESCALATED_OPTIONS } from '../../../src/config/escalated.config';

describe('EmailService', () => {
  let service: EmailService;
  let mailer: { sendMail: jest.Mock };

  const baseOptions = {
    mail: {
      from: 'support@example.com',
      transport: { service: 'postmark' as const, auth: { user: 'x', pass: 'y' } },
    },
    inbound: {
      replyDomain: 'reply.example.com',
      replySecret: 'hunter2',
      webhookSecret: 'whsec',
    },
    appName: 'TestApp',
    appUrl: 'https://app.example.com',
  };

  async function buildService(options: Record<string, unknown> = baseOptions) {
    mailer = { sendMail: jest.fn().mockResolvedValue({ accepted: ['to'] }) };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: MailerService, useValue: mailer },
        { provide: ESCALATED_OPTIONS, useValue: options },
      ],
    }).compile();
    service = moduleRef.get(EmailService);
  }

  beforeEach(async () => {
    await buildService();
  });

  describe('sendTicketCreated', () => {
    it('sends with subject from template, Message-ID and Reply-To headers', async () => {
      await service.sendTicketCreated({
        to: 'alice@example.com',
        ticket: { id: 55, referenceNumber: 'TK-XYZ', subject: 'Help!', description: 'Body' },
        contact: { email: 'alice@example.com', name: 'Alice' },
        guestAccessToken: 'tok',
      });

      expect(mailer.sendMail).toHaveBeenCalledTimes(1);
      const args = mailer.sendMail.mock.calls[0][0];
      expect(args.to).toBe('alice@example.com');
      expect(args.from).toBe('support@example.com');
      expect(args.subject).toContain('TK-XYZ');
      expect(args.subject).toContain('Help!');
      expect(args.html).toContain('Body');
      expect(args.text).toContain('Body');
      expect(args.headers['Message-ID']).toMatch(/^<ticket-55@reply\.example\.com>$/);
      expect(args.headers['X-Escalated-Ticket-Id']).toBe('55');
      expect(args.replyTo).toMatch(/^reply\+55\.[a-f0-9]{8}@reply\.example\.com$/);
    });

    it('omits the portal link when appUrl is not configured', async () => {
      await buildService({ ...baseOptions, appUrl: undefined });
      await service.sendTicketCreated({
        to: 'alice@example.com',
        ticket: { id: 1, referenceNumber: 'TK-1', subject: 's', description: 'd' },
        contact: { email: 'alice@example.com', name: null },
        guestAccessToken: 'tok',
      });
      const args = mailer.sendMail.mock.calls[0][0];
      expect(args.text).not.toContain('app.example.com');
    });
  });

  describe('sendReplyPosted', () => {
    it('threads via In-Reply-To and References headers pointing to ticket Message-ID', async () => {
      await service.sendReplyPosted({
        to: 'alice@example.com',
        ticket: { id: 55, referenceNumber: 'TK-XYZ', subject: 'Help' },
        reply: { id: 3, body: 'Agent reply body' },
        contact: { email: 'alice@example.com', name: 'Alice' },
        guestAccessToken: 'tok',
      });

      const args = mailer.sendMail.mock.calls[0][0];
      expect(args.subject).toContain('Re: Help');
      expect(args.text).toContain('Agent reply body');
      expect(args.headers['Message-ID']).toBe('<ticket-55-reply-3@reply.example.com>');
      expect(args.headers['In-Reply-To']).toBe('<ticket-55@reply.example.com>');
      expect(args.headers['References']).toBe('<ticket-55@reply.example.com>');
    });
  });

  describe('sendSignupInvite', () => {
    it('builds the signup link from signupUrlTemplate with {token} replacement', async () => {
      await buildService({
        ...baseOptions,
        guestPolicy: {
          mode: 'prompt_signup',
          signupUrlTemplate: 'https://app.example.com/signup?token={token}',
        },
      });

      await service.sendSignupInvite({
        to: 'alice@example.com',
        ticket: { id: 55, referenceNumber: 'TK-XYZ' },
        contact: { email: 'alice@example.com', name: 'Alice', id: 42 },
      });

      const args = mailer.sendMail.mock.calls[0][0];
      expect(args.subject).toContain('TK-XYZ');
      expect(args.html).toContain('https://app.example.com/signup?token=');
      expect(args.text).toContain('https://app.example.com/signup?token=');
    });

    it('is a no-op when signupUrlTemplate is not configured', async () => {
      await buildService({
        ...baseOptions,
        guestPolicy: { mode: 'prompt_signup' },
      });

      await service.sendSignupInvite({
        to: 'alice@example.com',
        ticket: { id: 55, referenceNumber: 'TK-XYZ' },
        contact: { email: 'alice@example.com', name: 'Alice', id: 42 },
      });

      expect(mailer.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('when mail is not configured', () => {
    it('is a no-op without throwing', async () => {
      await buildService({ appName: 'X' }); // no mail config
      await service.sendTicketCreated({
        to: 'alice@example.com',
        ticket: { id: 55, referenceNumber: 'TK-XYZ', subject: 's', description: 'd' },
        contact: { email: 'alice@example.com', name: null },
        guestAccessToken: 'tok',
      });
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });
  });
});
