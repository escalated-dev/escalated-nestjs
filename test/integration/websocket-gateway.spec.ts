import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { io, Socket } from 'socket.io-client';
import { bootEscalatedModule } from './boot-escalated-module';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { TicketService } from '../../src/services/ticket.service';
import { ReplyService } from '../../src/services/reply.service';
import { Contact, Ticket } from '../../src/entities';
import { GuestAccessService } from '../../src/services/guest-access.service';

jest.setTimeout(60000);

/**
 * Drives the real Socket.IO gateway over the network with the default
 * (unrestricted) visibility, which is what most hosts run.
 */

const AGENT = 1;
const CUSTOMER = 2;
const OTHER_CUSTOMER = 3;

interface Client {
  socket: Socket;
  events: Array<{ name: string; payload: any }>;
  disconnected: Promise<boolean>;
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

async function startApp(escalated: EscalatedModuleOptions) {
  const moduleRef = await bootEscalatedModule({
    escalated: {
      enableWebsockets: true,
      websocketAuth: (socket: any) => socket.handshake.auth?.userId ?? null,
      ...escalated,
    },
  });
  const source = moduleRef.get(DataSource);
  await source.initialize();
  await source.synchronize();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  return { app, source, url: await app.getUrl(), moduleRef };
}

function connect(url: string, auth: Record<string, unknown>): Promise<Client> {
  const socket = io(`${url.replace('[::1]', '127.0.0.1')}/escalated`, {
    auth,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  const events: Client['events'] = [];
  socket.onAny((name, payload) => events.push({ name, payload }));
  const disconnected = new Promise<boolean>((resolve) => {
    socket.on('disconnect', () => resolve(true));
    setTimeout(() => resolve(false), 1500).unref();
  });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve({ socket, events, disconnected }));
    socket.on('connect_error', reject);
  });
}

describe('websocket gateway authentication and scoping', () => {
  let app: INestApplication;
  let source: DataSource;
  let url: string;
  let tickets: TicketService;
  let replies: ReplyService;
  let guestAccess: GuestAccessService;
  const clients: Client[] = [];

  /** A guest grant for `ticket`, as verified guest access issues it. */
  const grantFor = async (ticket: Ticket) => {
    const contact = await source
      .getRepository(Contact)
      .save({ email: `guest${ticket.id}@example.com`, metadata: {} });
    await source.getRepository(Ticket).update(ticket.id, { contactId: contact.id });
    ticket.contactId = contact.id;
    guestAccess.markVerified(ticket, contact.email);
    return (await guestAccess.issue(ticket)).token;
  };

  const open = async (auth: Record<string, unknown>) => {
    const client = await connect(url, auth);
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    const started = await startApp({
      ticketAccess: {
        resolveUser: async (id) => ({ id, isAgent: Number(id) === AGENT, isAdmin: false }),
      },
    });
    ({ app, source, url } = started);
    tickets = started.moduleRef.get(TicketService);
    replies = started.moduleRef.get(ReplyService);
    guestAccess = started.moduleRef.get(GuestAccessService);
  });

  afterEach(() => {
    while (clients.length) clients.pop()!.socket.disconnect();
  });

  afterAll(async () => {
    await app?.close();
  });

  const newTicket = (requesterId: number, subject = 'Help') =>
    tickets.create({ subject, description: 'Details', priority: 'medium' } as any, requesterId);

  it('disconnects a socket with neither a user nor a guest token', async () => {
    const anonymous = await open({});
    expect(await anonymous.disconnected).toBe(true);
  });

  it('sends new tickets to agents only, without the guest token', async () => {
    const agent = await open({ userId: AGENT });
    const customer = await open({ userId: CUSTOMER });
    const guest = await open({ guestToken: 'not-a-real-token' });
    const ticket = await newTicket(CUSTOMER);
    await settle();

    const created = agent.events.filter((e) => e.name === 'ticket:created');
    expect(created).toHaveLength(1);
    expect(created[0].payload.ticket.id).toBe(ticket.id);
    expect(created[0].payload.ticket.guestAccessToken).toBeUndefined();
    expect(JSON.stringify(created[0].payload)).not.toContain(ticket.guestAccessToken);
    expect(customer.events).toEqual([]);
    expect(guest.events).toEqual([]);
  });

  it('lets a guest join only the ticket its token belongs to, and hides internal notes', async () => {
    const own = await newTicket(0, 'Guest ticket');
    const other = await newTicket(OTHER_CUSTOMER, 'Someone else');
    const guest = await open({ guestToken: await grantFor(own) });
    guest.socket.emit('join:ticket', { ticketId: own.id });
    guest.socket.emit('join:ticket', { ticketId: other.id });
    guest.socket.emit('join:agent', { agentId: AGENT });
    guest.socket.emit('join:chat-queue');
    await settle();

    await replies.create(own.id, { body: 'Public answer', type: 'reply' } as any, AGENT);
    await replies.create(
      own.id,
      { body: 'Internal only', type: 'note', isInternal: true } as any,
      AGENT,
    );
    await replies.create(other.id, { body: 'Other ticket', type: 'reply' } as any, AGENT);
    await tickets.update(other.id, { assigneeId: AGENT } as any, AGENT);
    await settle();

    const bodies = guest.events
      .filter((e) => e.name === 'ticket:reply')
      .map((e) => e.payload.reply.body);
    expect(bodies).toEqual(['Public answer']);
    expect(guest.events.some((e) => e.name === 'ticket:assigned')).toBe(false);
  });

  it('keeps customers out of other tickets, agent rooms and internal notes', async () => {
    const own = await newTicket(CUSTOMER, 'Mine');
    const other = await newTicket(OTHER_CUSTOMER, 'Not mine');
    const customer = await open({ userId: CUSTOMER });
    const agent = await open({ userId: AGENT });
    customer.socket.emit('join:ticket', { ticketId: own.id });
    customer.socket.emit('join:ticket', { ticketId: other.id });
    customer.socket.emit('join:agent', { agentId: CUSTOMER });
    agent.socket.emit('join:ticket', { ticketId: own.id });
    await settle();

    await replies.create(own.id, { body: 'Visible', type: 'reply' } as any, AGENT);
    await replies.create(
      own.id,
      { body: 'Staff note', type: 'note', isInternal: true } as any,
      AGENT,
    );
    await replies.create(other.id, { body: 'Leak?', type: 'reply' } as any, AGENT);
    await settle();

    const seen = (client: Client) =>
      client.events.filter((e) => e.name === 'ticket:reply').map((e) => e.payload.reply.body);
    expect(seen(customer)).toEqual(['Visible']);
    expect(seen(agent)).toEqual(['Visible', 'Staff note']);
  });

  it('only lets an agent join its own agent room', async () => {
    const agent = await open({ userId: AGENT });
    const customer = await open({ userId: CUSTOMER });
    agent.socket.emit('join:agent', { agentId: AGENT });
    customer.socket.emit('join:agent', { agentId: AGENT });
    await settle();
    const ticket = await newTicket(CUSTOMER, 'Assign me');
    await tickets.update(ticket.id, { assigneeId: AGENT } as any, AGENT);
    await settle();

    expect(agent.events.some((e) => e.name === 'ticket:assigned')).toBe(true);
    expect(customer.events.some((e) => e.name === 'ticket:assigned')).toBe(false);
    expect(
      agent.events
        .filter((e) => e.name === 'ticket:assigned')
        .every((e) => e.payload.ticket.guestAccessToken === undefined),
    ).toBe(true);
    await source.getRepository(Ticket).delete({ id: ticket.id });
  });
});

describe('websocket gateway without a role resolver', () => {
  let app: INestApplication;
  let tickets: TicketService;
  let url: string;

  beforeAll(async () => {
    const started = await startApp({});
    ({ app, url } = started);
    tickets = started.moduleRef.get(TicketService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('treats identified users as customers (fails closed for agent features)', async () => {
    const user = await connect(url, { userId: AGENT });
    user.socket.emit('join:agent', { agentId: AGENT });
    user.socket.emit('join:chat-queue');
    await settle();
    await tickets.create({ subject: 'x', description: 'y' } as any, CUSTOMER);
    await settle();
    expect(user.events).toEqual([]);
    user.socket.disconnect();
  });
});
