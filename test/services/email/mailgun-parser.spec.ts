import { MailgunInboundParser } from '../../../src/services/email/mailgun-parser.service';

describe('MailgunInboundParser', () => {
  const parser = new MailgunInboundParser();

  it('parses a new (un-threaded) inbound message', () => {
    const payload = {
      sender: 'alice@example.com',
      from: 'Alice <alice@example.com>',
      recipient: 'support@example.com',
      subject: 'My laptop broke',
      'body-plain': 'Help pls',
      'body-html': '<p>Help pls</p>',
      'Message-Id': '<abc123@mailgun-incoming>',
    };

    const parsed = parser.parse(payload);

    expect(parsed.from).toBe('alice@example.com');
    expect(parsed.fromName).toBe('Alice');
    expect(parsed.to).toBe('support@example.com');
    expect(parsed.subject).toBe('My laptop broke');
    expect(parsed.textBody).toBe('Help pls');
    expect(parsed.htmlBody).toBe('<p>Help pls</p>');
    expect(parsed.messageId).toBe('<abc123@mailgun-incoming>');
    expect(parsed.inReplyTo).toBeNull();
    expect(parsed.references).toEqual([]);
  });

  it('extracts In-Reply-To and References headers', () => {
    const payload = {
      sender: 'alice@example.com',
      from: 'Alice <alice@example.com>',
      recipient: 'reply+55.deadbeef@reply.example.com',
      subject: 'Re: [TK-1] thanks',
      'body-plain': 'thx',
      'Message-Id': '<m1@mailgun>',
      'In-Reply-To': '<ticket-55@reply.example.com>',
      References: '<ticket-55@reply.example.com> <ticket-55-reply-3@reply.example.com>',
    };

    const parsed = parser.parse(payload);

    expect(parsed.inReplyTo).toBe('<ticket-55@reply.example.com>');
    expect(parsed.references).toEqual([
      '<ticket-55@reply.example.com>',
      '<ticket-55-reply-3@reply.example.com>',
    ]);
  });

  it('falls back to extracting email from from field when sender is missing', () => {
    const payload = {
      from: 'Bare <bare@example.com>',
      recipient: 'support@example.com',
      subject: 'x',
    };

    const parsed = parser.parse(payload);

    expect(parsed.from).toBe('bare@example.com');
    expect(parsed.fromName).toBe('Bare');
  });

  it('returns null fromName when the from field has no angle brackets', () => {
    const payload = {
      sender: 'alice@example.com',
      from: 'alice@example.com',
      recipient: 'support@example.com',
      subject: 'hi',
    };

    const parsed = parser.parse(payload);

    expect(parsed.fromName).toBeNull();
  });

  it('strips surrounding quotes from display name', () => {
    const payload = {
      sender: 'alice@example.com',
      from: '"Alice Doe" <alice@example.com>',
      recipient: 'support@example.com',
      subject: 'hi',
    };

    const parsed = parser.parse(payload);

    expect(parsed.fromName).toBe('Alice Doe');
  });

  it('uses To as fallback recipient when recipient is missing', () => {
    const parsed = parser.parse({
      sender: 'alice@example.com',
      To: 'other@example.com',
      subject: 'hi',
    });

    expect(parsed.to).toBe('other@example.com');
  });

  it('returns empty arrays and null for missing optional fields', () => {
    const parsed = parser.parse({
      sender: 'alice@example.com',
      recipient: 'support@example.com',
      subject: '',
    });

    expect(parsed.textBody).toBe('');
    expect(parsed.htmlBody).toBeNull();
    expect(parsed.messageId).toBeNull();
    expect(parsed.inReplyTo).toBeNull();
    expect(parsed.references).toEqual([]);
  });

  it('normalizes null payload to empty defaults', () => {
    const parsed = parser.parse(null);

    expect(parsed.from).toBe('');
    expect(parsed.to).toBe('');
    expect(parsed.subject).toBe('');
    expect(parsed.fromName).toBeNull();
  });
});
