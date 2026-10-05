import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { TicketService } from '../../src/services/ticket.service';
import { ReplyService } from '../../src/services/reply.service';
import { ContactService } from '../../src/services/contact.service';
import { SettingsService } from '../../src/services/settings.service';
import { Ticket } from '../../src/entities/ticket.entity';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

jest.setTimeout(60000);

/**
 * The guest widget endpoints are unauthenticated and every accepted request
 * creates rows and sends outbound mail, so the module itself must cap them per
 * client IP (ticket creation 5/min, guest replies 10/min by default) rather
 * than relying on each host app to put a throttle in front.
 */
describe('guest endpoint rate limiting', () => {
  let app: INestApplication | undefined;
  let tickets: { create: jest.Mock };
  let replies: { create: jest.Mock };

  async function start(escalated?: EscalatedModuleOptions) {
    tickets = { create: jest.fn(async () => ({ id: 1, guestAccessToken: 'guest-token' })) };
    replies = { create: jest.fn(async () => ({ id: 7 })) };
    const ticketRepo = {
      findOne: jest.fn(async ({ where }: { where: { guestAccessToken: string } }) =>
        where.guestAccessToken === 'guest-token'
          ? { id: 1, requesterId: 0, guestAccessToken: 'guest-token' }
          : null,
      ),
    };

    const moduleRef = await bootEscalatedModule({
      escalated,
      configure: (builder) =>
        builder
          .overrideProvider(TicketService)
          .useValue(tickets)
          .overrideProvider(ReplyService)
          .useValue(replies)
          .overrideProvider(ContactService)
          .useValue({ findOrCreateByEmail: jest.fn(async () => ({ id: 99 })) })
          .overrideProvider(SettingsService)
          .useValue({ getTyped: jest.fn(async (_key: string, fallback: unknown) => fallback) })
          .overrideProvider(getRepositoryToken(Ticket))
          .useValue(ticketRepo),
    });

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();

    const post = (path: string, body: Record<string, unknown>, headers = {}) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });

    return {
      // A distinct email per call, so only the per-IP limit can be what trips.
      createTicket: (n: number) =>
        post('/escalated/widget/tickets', {
          email: `guest${n}@x.com`,
          subject: 'Help',
          description: 'd',
        }),
      reply: (token = 'guest-token') =>
        post('/escalated/widget/tickets/1/replies', { body: 'hi' }, { 'X-Guest-Token': token }),
    };
  }

  async function statuses(times: number, send: (n: number) => Promise<Response>) {
    const out: number[] = [];
    for (let i = 0; i < times; i++) out.push((await send(i)).status);
    return out;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('answers the 6th guest ticket from one IP within a minute with 429', async () => {
    const { createTicket } = await start();

    expect(await statuses(6, createTicket)).toEqual([201, 201, 201, 201, 201, 429]);
    expect(tickets.create).toHaveBeenCalledTimes(5);
  });

  it('answers the 11th guest reply from one IP within a minute with 429', async () => {
    const { reply } = await start();

    const out = await statuses(11, () => reply());

    expect(out.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(out[10]).toBe(429);
    expect(replies.create).toHaveBeenCalledTimes(10);
  });

  it('counts replies carrying a bad guest token, so tokens cannot be guessed at speed', async () => {
    const { reply } = await start({ guestRateLimit: { repliesPerMinute: 2 } });

    expect(await statuses(3, () => reply('wrong'))).toEqual([403, 403, 429]);
  });

  it('takes its limits from the module options', async () => {
    const { createTicket } = await start({ guestRateLimit: { ticketsPerMinute: 2 } });

    expect(await statuses(3, createTicket)).toEqual([201, 201, 429]);
  });

  it('lets a host that throttles upstream switch it off', async () => {
    const { createTicket } = await start({ guestRateLimit: { enabled: false } });

    expect((await statuses(8, createTicket)).every((s) => s === 201)).toBe(true);
  });
});
