import {
  SESInboundParser,
  SESSubscriptionConfirmationError,
} from '../../../src/services/email/ses-parser.service';

describe('SESInboundParser', () => {
  const parser = new SESInboundParser();

  describe('subscription confirmation', () => {
    it('throws SESSubscriptionConfirmationError with the SubscribeURL', () => {
      const envelope = {
        Type: 'SubscriptionConfirmation',
        TopicArn: 'arn:aws:sns:us-east-1:123:escalated-inbound',
        SubscribeURL:
          'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x',
        Token: 'abc',
      };

      expect(() => parser.parse(envelope)).toThrow(SESSubscriptionConfirmationError);

      try {
        parser.parse(envelope);
      } catch (err) {
        const ex = err as SESSubscriptionConfirmationError;
        expect(ex.topicArn).toBe('arn:aws:sns:us-east-1:123:escalated-inbound');
        expect(ex.subscribeUrl).toContain('ConfirmSubscription');
        expect(ex.token).toBe('abc');
      }
    });
  });

  describe('notification', () => {
    it('extracts threading metadata from commonHeaders + headers', () => {
      const sesMessage = {
        notificationType: 'Received',
        mail: {
          source: 'alice@example.com',
          destination: ['support@example.com'],
          headers: [
            { name: 'From', value: 'Alice <alice@example.com>' },
            { name: 'To', value: 'support@example.com' },
            { name: 'Subject', value: '[ESC-42] Re: Help' },
            { name: 'Message-ID', value: '<external-xyz@mail.alice.com>' },
            { name: 'In-Reply-To', value: '<ticket-42@support.example.com>' },
            { name: 'References', value: '<ticket-42@support.example.com> <prev@mail.com>' },
          ],
          commonHeaders: {
            from: ['Alice <alice@example.com>'],
            to: ['support@example.com'],
            subject: '[ESC-42] Re: Help',
          },
        },
      };
      const envelope = {
        Type: 'Notification',
        Message: JSON.stringify(sesMessage),
      };

      const parsed = parser.parse(envelope);

      expect(parsed.from).toBe('alice@example.com');
      expect(parsed.fromName).toBe('Alice');
      expect(parsed.to).toBe('support@example.com');
      expect(parsed.subject).toBe('[ESC-42] Re: Help');
      expect(parsed.messageId).toBe('<external-xyz@mail.alice.com>');
      expect(parsed.inReplyTo).toBe('<ticket-42@support.example.com>');
      expect(parsed.references).toEqual([
        '<ticket-42@support.example.com>',
        '<prev@mail.com>',
      ]);
    });

    it('decodes plain text body from base64 MIME content', () => {
      const mime =
        'From: alice@example.com\r\n' +
        'To: support@example.com\r\n' +
        'Subject: Hi\r\n' +
        'Content-Type: text/plain; charset="utf-8"\r\n' +
        '\r\n' +
        'This is the plain text body.';
      const contentB64 = Buffer.from(mime).toString('base64');

      const envelope = {
        Type: 'Notification',
        Message: JSON.stringify({
          mail: {
            commonHeaders: {
              from: ['alice@example.com'],
              to: ['support@example.com'],
              subject: 'Hi',
            },
          },
          content: contentB64,
        }),
      };

      const parsed = parser.parse(envelope);

      expect(parsed.textBody).toContain('This is the plain text body.');
    });

    it('decodes multipart/alternative bodies', () => {
      const boundary = 'boundary-abc';
      const mime =
        'From: alice@example.com\r\n' +
        'To: support@example.com\r\n' +
        'Subject: Hi\r\n' +
        `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
        '\r\n' +
        `--${boundary}\r\n` +
        'Content-Type: text/plain; charset="utf-8"\r\n' +
        '\r\n' +
        'Plain body\r\n' +
        `--${boundary}\r\n` +
        'Content-Type: text/html; charset="utf-8"\r\n' +
        '\r\n' +
        '<p>HTML body</p>\r\n' +
        `--${boundary}--\r\n`;
      const contentB64 = Buffer.from(mime).toString('base64');

      const envelope = {
        Type: 'Notification',
        Message: JSON.stringify({
          mail: {
            commonHeaders: {
              from: ['alice@example.com'],
              to: ['support@example.com'],
              subject: 'Hi',
            },
          },
          content: contentB64,
        }),
      };

      const parsed = parser.parse(envelope);

      expect(parsed.textBody).toContain('Plain body');
      expect(parsed.htmlBody).toContain('<p>HTML body</p>');
    });

    it('leaves body empty when content is missing', () => {
      const envelope = {
        Type: 'Notification',
        Message: JSON.stringify({
          mail: {
            commonHeaders: {
              from: ['alice@example.com'],
              to: ['support@example.com'],
              subject: 'Hi',
            },
          },
        }),
      };

      const parsed = parser.parse(envelope);

      expect(parsed.textBody).toBe('');
      expect(parsed.htmlBody).toBeNull();
      expect(parsed.from).toBe('alice@example.com');
    });

    it('falls back to headers array for threading fields when commonHeaders lacks them', () => {
      const envelope = {
        Type: 'Notification',
        Message: JSON.stringify({
          mail: {
            headers: [
              { name: 'Message-ID', value: '<fallback@mail.com>' },
              { name: 'In-Reply-To', value: '<ticket-99@support.example.com>' },
            ],
            commonHeaders: {
              from: ['alice@example.com'],
              to: ['support@example.com'],
              subject: 'Fallback',
            },
          },
        }),
      };

      const parsed = parser.parse(envelope);

      expect(parsed.messageId).toBe('<fallback@mail.com>');
      expect(parsed.inReplyTo).toBe('<ticket-99@support.example.com>');
    });
  });

  describe('error handling', () => {
    it('throws for unknown envelope types', () => {
      expect(() => parser.parse({ Type: 'UnknownType' })).toThrow(
        /Unsupported SNS envelope type/,
      );
    });

    it('throws when Message field is missing', () => {
      expect(() => parser.parse({ Type: 'Notification' })).toThrow(/no Message body/);
    });

    it('throws for malformed Message JSON', () => {
      expect(() =>
        parser.parse({ Type: 'Notification', Message: 'not json at all' }),
      ).toThrow(/not valid JSON/);
    });
  });
});
