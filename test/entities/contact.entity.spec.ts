import { Contact } from '../../src/entities/contact.entity';

describe('Contact entity', () => {
  it('constructs with required email and optional name', () => {
    const c = new Contact();
    c.email = 'alice@example.com';
    c.name = 'Alice';
    expect(c.email).toBe('alice@example.com');
    expect(c.name).toBe('Alice');
  });

  it('allows nullable name and nullable userId for guests', () => {
    const c = new Contact();
    c.email = 'guest@example.com';
    c.name = null;
    c.userId = null;
    expect(c.name).toBeNull();
    expect(c.userId).toBeNull();
  });

  it('accepts a metadata bag', () => {
    const c = new Contact();
    c.metadata = { referrer: 'widget', utm: 'x' };
    expect(c.metadata.referrer).toBe('widget');
  });
});
