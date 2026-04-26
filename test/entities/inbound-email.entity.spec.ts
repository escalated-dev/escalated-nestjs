import { InboundEmail } from '../../src/entities/inbound-email.entity';

describe('InboundEmail entity', () => {
  it('captures the raw payload and parsed summary', () => {
    const e = new InboundEmail();
    e.provider = 'postmark';
    e.rawPayload = { From: 'a@b.com', Subject: 'Hi' };
    e.parsedFrom = 'a@b.com';
    e.parsedSubject = 'Hi';
    expect(e.provider).toBe('postmark');
    expect(e.rawPayload.From).toBe('a@b.com');
  });

  it('tracks routing outcome', () => {
    const e = new InboundEmail();
    e.outcome = 'reply_added';
    e.matchedTicketId = 55;
    e.createdReplyId = 9;
    expect(e.outcome).toBe('reply_added');
    expect(e.matchedTicketId).toBe(55);
  });

  it('records errors for the failed path', () => {
    const e = new InboundEmail();
    e.outcome = 'error';
    e.error = 'boom';
    expect(e.error).toBe('boom');
  });
});
