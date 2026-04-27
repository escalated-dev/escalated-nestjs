import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InboundEmailController } from '../../src/controllers/inbound-email.controller';
import { InboundRouterService } from '../../src/services/email/inbound-router.service';
import { PostmarkInboundParser } from '../../src/services/email/postmark-parser.service';
import { MailgunInboundParser } from '../../src/services/email/mailgun-parser.service';
import { SESInboundParser } from '../../src/services/email/ses-parser.service';
import { InboundEmail } from '../../src/entities/inbound-email.entity';
import { ESCALATED_OPTIONS } from '../../src/config/escalated.config';

describe('InboundEmailController', () => {
  let controller: InboundEmailController;
  let router: { route: jest.Mock };
  let parser: { parse: jest.Mock };
  let inboundRepo: { save: jest.Mock };

  beforeEach(async () => {
    router = {
      route: jest.fn().mockResolvedValue({
        outcome: 'ticket_created',
        createdTicketId: 42,
      }),
    };
    parser = {
      parse: jest.fn().mockReturnValue({
        from: 'alice@x.com',
        fromName: 'Alice',
        to: 'support@x.com',
        subject: 'hi',
        textBody: 'body',
        htmlBody: null,
        messageId: null,
        inReplyTo: null,
        references: [],
      }),
    };
    inboundRepo = {
      save: jest.fn(async (x) => ({ id: 1, ...x })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InboundEmailController],
      providers: [
        { provide: InboundRouterService, useValue: router },
        { provide: PostmarkInboundParser, useValue: parser },
        { provide: MailgunInboundParser, useValue: { parse: jest.fn() } },
        { provide: SESInboundParser, useValue: { parse: jest.fn() } },
        { provide: getRepositoryToken(InboundEmail), useValue: inboundRepo },
        {
          provide: ESCALATED_OPTIONS,
          useValue: {
            inbound: {
              provider: 'postmark',
              replyDomain: 'x',
              replySecret: 'y',
              webhookSecret: 'z',
            },
          },
        },
      ],
    }).compile();

    controller = module.get(InboundEmailController);
  });

  it('parses the body, routes it, and persists an audit row', async () => {
    const body = { From: 'alice@x.com', Subject: 'hi', TextBody: 'body' };
    const response = await controller.receive(body);

    expect(parser.parse).toHaveBeenCalledWith(body);
    expect(router.route).toHaveBeenCalled();
    expect(inboundRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'postmark',
        rawPayload: body,
        parsedFrom: 'alice@x.com',
        outcome: 'ticket_created',
        createdTicketId: 42,
      }),
    );
    expect(response).toEqual({ ok: true, outcome: 'ticket_created' });
  });

  it('persists the error audit row when the router errors', async () => {
    router.route.mockResolvedValue({ outcome: 'error', error: 'boom' });

    const response = await controller.receive({});

    expect(inboundRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', error: 'boom' }),
    );
    expect(response).toEqual({ ok: false, outcome: 'error' });
  });

  it('persists an ignored audit row when the router ignores', async () => {
    router.route.mockResolvedValue({ outcome: 'ignored' });

    const response = await controller.receive({});

    expect(inboundRepo.save).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ignored' }));
    expect(response).toEqual({ ok: true, outcome: 'ignored' });
  });

  it('picks the Mailgun parser when options.inbound.provider is mailgun', async () => {
    const mailgunParser = {
      parse: jest.fn().mockReturnValue({
        from: 'alice@x.com',
        fromName: 'Alice',
        to: 'support@x.com',
        subject: 'hi',
        textBody: 'body',
        htmlBody: null,
        messageId: null,
        inReplyTo: null,
        references: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InboundEmailController],
      providers: [
        { provide: InboundRouterService, useValue: router },
        { provide: PostmarkInboundParser, useValue: parser },
        { provide: MailgunInboundParser, useValue: mailgunParser },
        { provide: SESInboundParser, useValue: { parse: jest.fn() } },
        { provide: getRepositoryToken(InboundEmail), useValue: inboundRepo },
        {
          provide: ESCALATED_OPTIONS,
          useValue: {
            inbound: {
              provider: 'mailgun',
              replyDomain: 'x',
              replySecret: 'y',
              webhookSecret: 'z',
            },
          },
        },
      ],
    }).compile();
    const mailgunController = module.get(InboundEmailController);

    await mailgunController.receive({ sender: 'alice@x.com' });

    expect(mailgunParser.parse).toHaveBeenCalled();
    expect(parser.parse).not.toHaveBeenCalled();
    expect(inboundRepo.save).toHaveBeenCalledWith(expect.objectContaining({ provider: 'mailgun' }));
  });
});
