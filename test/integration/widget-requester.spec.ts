import { INestApplication } from '@nestjs/common';
import { bootEscalatedModule } from './boot-escalated-module';
import { TicketService } from '../../src/services/ticket.service';
import { ContactService } from '../../src/services/contact.service';
import { SettingsService } from '../../src/services/settings.service';

jest.setTimeout(60000);

/**
 * POST /escalated/widget/tickets is public. Who a ticket belongs to must come
 * from the submitter's email (through the guest policy) or from a host user the
 * host app has authenticated on the request, never from a `requesterId` the
 * anonymous caller typed into the body.
 */
describe('POST /escalated/widget/tickets requester identity', () => {
  let app: INestApplication | undefined;
  let tickets: { create: jest.Mock };
  let contacts: { findOrCreateByEmail: jest.Mock };

  async function start(authenticatedUser?: { id: number }) {
    tickets = { create: jest.fn(async () => ({ id: 1, guestAccessToken: 'guest-token' })) };
    contacts = { findOrCreateByEmail: jest.fn(async () => ({ id: 99, email: 'alice@x.com' })) };

    const moduleRef = await bootEscalatedModule({
      configure: (builder) =>
        builder
          .overrideProvider(TicketService)
          .useValue(tickets)
          .overrideProvider(ContactService)
          .useValue(contacts)
          .overrideProvider(SettingsService)
          .useValue({ getTyped: jest.fn(async (_key: string, fallback: unknown) => fallback) }),
    });

    app = moduleRef.createNestApplication({ logger: false });
    if (authenticatedUser) {
      // Stands in for the host app's own authentication middleware.
      app.use((req: any, _res: unknown, next: () => void) => {
        req.user = authenticatedUser;
        next();
      });
    }
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();

    return (body: Record<string, unknown>) =>
      fetch(`${base}/escalated/widget/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  describe('anonymous submitter', () => {
    it('cannot create a ticket as another user by sending requesterId', async () => {
      const submit = await start();

      const res = await submit({ requesterId: 42, subject: 'Refund me', description: 'd' });

      expect(res.status).toBe(400);
      expect(tickets.create).not.toHaveBeenCalled();
    });

    it('cannot override the guest policy requester alongside an email', async () => {
      const submit = await start();

      const res = await submit({
        email: 'alice@x.com',
        requesterId: 42,
        subject: 'Help',
        description: 'd',
      });

      expect(res.status).toBe(201);
      expect(tickets.create).toHaveBeenCalledWith(expect.objectContaining({ contactId: 99 }), 0);
    });
  });

  describe('submitter authenticated by the host app', () => {
    it('files the ticket as the authenticated user, not the requesterId in the body', async () => {
      const submit = await start({ id: 7 });

      const res = await submit({ requesterId: 42, subject: 'Help', description: 'd' });

      expect(res.status).toBe(201);
      expect(tickets.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'widget' }),
        7,
      );
    });

    it('does not need to send requesterId at all', async () => {
      const submit = await start({ id: 7 });

      const res = await submit({ subject: 'Help', description: 'd' });

      expect(res.status).toBe(201);
      expect(tickets.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'widget' }),
        7,
      );
    });
  });
});
