import { Ticket } from '../../src/entities/ticket.entity';

describe('Ticket.contactId', () => {
  it('is nullable', () => {
    const t = new Ticket();
    t.contactId = null;
    expect(t.contactId).toBeNull();
  });

  it('accepts a numeric id', () => {
    const t = new Ticket();
    t.contactId = 42;
    expect(t.contactId).toBe(42);
  });

  it('is independent of requesterId (both coexist)', () => {
    const t = new Ticket();
    t.requesterId = 7;
    t.contactId = 42;
    expect(t.requesterId).toBe(7);
    expect(t.contactId).toBe(42);
  });
});
