import {
  buildMessageId,
  parseTicketIdFromMessageId,
  buildReplyTo,
  verifyReplyTo,
} from '../../../src/services/email/message-id';

describe('message-id helpers', () => {
  describe('buildMessageId', () => {
    it('formats ticket-only id', () => {
      expect(buildMessageId(55, null, 'example.com')).toBe('<ticket-55@example.com>');
    });

    it('formats ticket+reply id', () => {
      expect(buildMessageId(55, 3, 'example.com')).toBe('<ticket-55-reply-3@example.com>');
    });

    it('works with undefined replyId', () => {
      expect(buildMessageId(7, undefined, 'x.com')).toBe('<ticket-7@x.com>');
    });
  });

  describe('parseTicketIdFromMessageId', () => {
    it('extracts from ticket-only id', () => {
      expect(parseTicketIdFromMessageId('<ticket-55@example.com>')).toBe(55);
    });

    it('extracts from ticket+reply id', () => {
      expect(parseTicketIdFromMessageId('<ticket-55-reply-3@example.com>')).toBe(55);
    });

    it('accepts id with or without angle brackets', () => {
      expect(parseTicketIdFromMessageId('ticket-42@x.com')).toBe(42);
    });

    it('returns null when no match', () => {
      expect(parseTicketIdFromMessageId('<unrelated@example.com>')).toBeNull();
      expect(parseTicketIdFromMessageId('not-an-id')).toBeNull();
      expect(parseTicketIdFromMessageId('')).toBeNull();
    });
  });

  describe('buildReplyTo / verifyReplyTo', () => {
    const domain = 'reply.example.com';
    const secret = 'super-secret';

    it('round-trips a valid reply-to address', () => {
      const addr = buildReplyTo(55, secret, domain);
      expect(addr).toMatch(/^reply\+55\.[a-f0-9]{8}@reply\.example\.com$/);
      expect(verifyReplyTo(addr, secret)).toEqual({ ok: true, ticketId: 55 });
    });

    it('rejects tampered signatures', () => {
      const tampered = 'reply+55.deadbeef@reply.example.com';
      expect(verifyReplyTo(tampered, secret)).toEqual({ ok: false });
    });

    it('rejects a different ticket id with a valid sig for another ticket', () => {
      const addr = buildReplyTo(55, secret, domain);
      const swapped = addr.replace('reply+55.', 'reply+99.');
      expect(verifyReplyTo(swapped, secret)).toEqual({ ok: false });
    });

    it('rejects malformed local parts', () => {
      expect(verifyReplyTo('not-an-email', secret)).toEqual({ ok: false });
      expect(verifyReplyTo('reply@x.com', secret)).toEqual({ ok: false });
      expect(verifyReplyTo('reply+@x.com', secret)).toEqual({ ok: false });
      expect(verifyReplyTo('reply+abc@x.com', secret)).toEqual({ ok: false });
    });
  });
});
