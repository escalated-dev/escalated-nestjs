import { PostmarkInboundParser } from '../../../src/services/email/postmark-parser.service';

describe('PostmarkInboundParser', () => {
  const parser = new PostmarkInboundParser();

  it('parses a new (un-threaded) inbound message', () => {
    const payload = {
      From: 'alice@example.com',
      FromName: 'Alice',
      To: 'support@example.com',
      Subject: 'My laptop broke',
      TextBody: 'Help pls',
      HtmlBody: '<p>Help pls</p>',
      MessageID: 'abc123@postmark',
      Headers: [{ Name: 'Message-ID', Value: '<inbound-abc123@mail.example.com>' }],
    };

    const parsed = parser.parse(payload);

    expect(parsed.from).toBe('alice@example.com');
    expect(parsed.fromName).toBe('Alice');
    expect(parsed.to).toBe('support@example.com');
    expect(parsed.subject).toBe('My laptop broke');
    expect(parsed.textBody).toBe('Help pls');
    expect(parsed.htmlBody).toBe('<p>Help pls</p>');
    expect(parsed.messageId).toBe('<inbound-abc123@mail.example.com>');
    expect(parsed.inReplyTo).toBeNull();
    expect(parsed.references).toEqual([]);
  });

  it('extracts In-Reply-To and References from Headers', () => {
    const payload = {
      From: 'alice@example.com',
      To: 'reply+55.deadbeef@reply.example.com',
      Subject: 'Re: [TK-1] thanks',
      TextBody: 'thx',
      Headers: [
        { Name: 'Message-ID', Value: '<m1@mail>' },
        { Name: 'In-Reply-To', Value: '<ticket-55@reply.example.com>' },
        {
          Name: 'References',
          Value: '<ticket-55@reply.example.com> <ticket-55-reply-3@reply.example.com>',
        },
      ],
    };

    const parsed = parser.parse(payload);

    expect(parsed.inReplyTo).toBe('<ticket-55@reply.example.com>');
    expect(parsed.references).toEqual([
      '<ticket-55@reply.example.com>',
      '<ticket-55-reply-3@reply.example.com>',
    ]);
  });

  it('falls back to FromFull.Email when From is absent', () => {
    const payload = {
      FromFull: { Email: 'a@b.com', Name: 'A' },
      To: 'support@example.com',
      Subject: 'hi',
      TextBody: 'x',
    };

    const parsed = parser.parse(payload);
    expect(parsed.from).toBe('a@b.com');
    expect(parsed.fromName).toBe('A');
  });

  it('handles missing Headers gracefully', () => {
    const payload = {
      From: 'a@b.com',
      To: 'support@example.com',
      Subject: 'hi',
      TextBody: 'x',
    };

    const parsed = parser.parse(payload);
    expect(parsed.messageId).toBeNull();
    expect(parsed.inReplyTo).toBeNull();
    expect(parsed.references).toEqual([]);
  });

  it('is case-insensitive on header names', () => {
    const payload = {
      From: 'a@b.com',
      To: 'support@example.com',
      Subject: 'hi',
      TextBody: 'x',
      Headers: [
        { Name: 'in-reply-to', Value: '<m1@mail>' },
        { Name: 'REFERENCES', Value: '<r1@mail>' },
      ],
    };

    const parsed = parser.parse(payload);
    expect(parsed.inReplyTo).toBe('<m1@mail>');
    expect(parsed.references).toEqual(['<r1@mail>']);
  });
});
