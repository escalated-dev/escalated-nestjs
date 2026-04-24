import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePublicTicketDto } from '../../src/dto/create-public-ticket.dto';

async function errorsFor(raw: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(CreatePublicTicketDto, raw);
  const errors = await validate(instance);
  return errors.map((e) => e.property);
}

describe('CreatePublicTicketDto', () => {
  it('accepts a minimal valid payload', async () => {
    const errors = await errorsFor({
      email: 'a@b.com',
      subject: 'Help',
      description: 'Need help',
    });
    expect(errors).toEqual([]);
  });

  it('rejects missing email', async () => {
    const errors = await errorsFor({ subject: 'Help', description: 'x' });
    expect(errors).toContain('email');
  });

  it('rejects an invalid email', async () => {
    const errors = await errorsFor({
      email: 'not-an-email',
      subject: 'Help',
      description: 'x',
    });
    expect(errors).toContain('email');
  });

  it('rejects an empty subject', async () => {
    const errors = await errorsFor({
      email: 'a@b.com',
      subject: '',
      description: 'x',
    });
    expect(errors).toContain('subject');
  });

  it('rejects a subject over 500 chars', async () => {
    const errors = await errorsFor({
      email: 'a@b.com',
      subject: 'x'.repeat(501),
      description: 'x',
    });
    expect(errors).toContain('subject');
  });

  it('accepts optional name and priority', async () => {
    const errors = await errorsFor({
      email: 'a@b.com',
      name: 'Alice',
      subject: 'Help',
      description: 'x',
      priority: 'high',
    });
    expect(errors).toEqual([]);
  });

  it('rejects an invalid priority value', async () => {
    const errors = await errorsFor({
      email: 'a@b.com',
      subject: 'Help',
      description: 'x',
      priority: 'nuclear',
    });
    expect(errors).toContain('priority');
  });

  it('rejects a name over 255 chars', async () => {
    const errors = await errorsFor({
      email: 'a@b.com',
      name: 'n'.repeat(256),
      subject: 'Help',
      description: 'x',
    });
    expect(errors).toContain('name');
  });
});
