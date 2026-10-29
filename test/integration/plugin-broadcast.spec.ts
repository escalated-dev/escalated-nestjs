import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { io, Socket } from 'socket.io-client';
import { bootEscalatedModule } from './boot-escalated-module';
import type { EscalatedPluginDefinition, PluginContext } from '../../src/plugins/plugin-definition';
import { PluginRegistry } from '../../src/plugins/plugin-registry.service';
import { TicketService } from '../../src/services/ticket.service';

jest.setTimeout(60000);

/**
 * `ctx.broadcast` through the real Socket.IO gateway, with Laravel's
 * audiences: `toChannel` reaches sockets that joined that plugin channel,
 * `toUser` that user's own sockets, and `toTicket` sockets in the ticket's
 * room that may see the ticket.
 */

const AGENT = 1;
const CUSTOMER = 2;
const OTHER_CUSTOMER = 3;

interface Client {
  socket: Socket;
  events: Array<{ name: string; payload: any }>;
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(url: string, auth: Record<string, unknown>): Promise<Client> {
  const socket = io(`${url.replace('[::1]', '127.0.0.1')}/escalated`, {
    auth,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  const events: Client['events'] = [];
  socket.onAny((name, payload) => events.push({ name, payload }));
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve({ socket, events }));
    socket.on('connect_error', reject);
  });
}

describe('ctx.broadcast through the WebSocket gateway', () => {
  let app: INestApplication;
  let url: string;
  let tickets: TicketService;
  let ctx: PluginContext;
  const clients: Client[] = [];

  const crm: EscalatedPluginDefinition = {
    name: 'crm',
    version: '1.0.0',
    onActivate: async (given) => {
      ctx = given;
    },
  };

  const open = async (auth: Record<string, unknown>) => {
    const client = await connect(url, auth);
    clients.push(client);
    return client;
  };

  const named = (client: Client, name: string) =>
    client.events.filter((event) => event.name === name).map((event) => event.payload);

  beforeAll(async () => {
    const moduleRef = await bootEscalatedModule({
      escalated: {
        enableWebsockets: true,
        websocketAuth: (socket: any) => socket.handshake.auth?.userId ?? null,
        ticketAccess: {
          resolveUser: async (id) => ({ id, isAgent: Number(id) === AGENT, isAdmin: false }),
        },
        plugins: [crm],
      },
    });
    const source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    tickets = moduleRef.get(TicketService);
    await moduleRef.get(PluginRegistry).activate('crm');
  });

  afterEach(() => {
    while (clients.length) clients.pop()!.socket.disconnect();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('toChannel reaches the sockets that joined that plugin channel', async () => {
    const listening = await open({ userId: CUSTOMER });
    const elsewhere = await open({ userId: OTHER_CUSTOMER });
    listening.socket.emit('join:plugin', { channel: 'crm-sync' });
    elsewhere.socket.emit('join:plugin', { channel: 'other' });
    await settle();

    await ctx.broadcast.toChannel('crm-sync', 'crm.synced', { count: 2 });
    await settle();

    expect(named(listening, 'crm.synced')).toEqual([{ count: 2 }]);
    expect(named(elsewhere, 'crm.synced')).toEqual([]);

    listening.socket.emit('leave:plugin', { channel: 'crm-sync' });
    await settle();
    await ctx.broadcast.toChannel('crm-sync', 'crm.synced', { count: 3 });
    await settle();
    expect(named(listening, 'crm.synced')).toEqual([{ count: 2 }]);
  });

  it('toUser reaches only that user’s sockets', async () => {
    const customer = await open({ userId: CUSTOMER });
    const sameCustomer = await open({ userId: CUSTOMER });
    const other = await open({ userId: OTHER_CUSTOMER });
    await settle();

    await ctx.broadcast.toUser(CUSTOMER, 'crm.note', { text: 'hi' });
    await settle();

    expect(named(customer, 'crm.note')).toEqual([{ text: 'hi' }]);
    expect(named(sameCustomer, 'crm.note')).toEqual([{ text: 'hi' }]);
    expect(named(other, 'crm.note')).toEqual([]);
  });

  it('toTicket reaches sockets in the ticket’s room that may see it, without guest tokens', async () => {
    const ticket = await tickets.create(
      { subject: 'Help', description: 'Details', priority: 'medium' } as any,
      CUSTOMER,
    );
    const requester = await open({ userId: CUSTOMER });
    const agent = await open({ userId: AGENT });
    const stranger = await open({ userId: OTHER_CUSTOMER });
    const notJoined = await open({ userId: CUSTOMER });
    for (const client of [requester, agent, stranger]) {
      client.socket.emit('join:ticket', { ticketId: ticket.id });
    }
    await settle();

    await ctx.broadcast.toTicket(ticket.id, 'crm.linked', {
      deal: 'D-1',
      guestAccessToken: 'secret',
    });
    await settle();

    expect(named(requester, 'crm.linked')).toEqual([{ deal: 'D-1' }]);
    expect(named(agent, 'crm.linked')).toEqual([{ deal: 'D-1' }]);
    expect(named(stranger, 'crm.linked')).toEqual([]);
    expect(named(notJoined, 'crm.linked')).toEqual([]);
  });

  it('refuses a call without a channel, user, ticket or event', async () => {
    await expect(ctx.broadcast.toChannel('', 'x', {})).rejects.toThrow();
    await expect(ctx.broadcast.toUser(CUSTOMER, '', {})).rejects.toThrow();
    await expect(ctx.broadcast.toTicket(undefined as any, 'x', {})).rejects.toThrow();
  });
});

describe('ctx.broadcast without the WebSocket gateway', () => {
  it('does nothing', async () => {
    let ctx!: PluginContext;
    const moduleRef = await bootEscalatedModule({
      escalated: {
        plugins: [
          {
            name: 'crm',
            version: '1.0.0',
            onActivate: async (given) => {
              ctx = given;
            },
          },
        ],
      },
    });
    const source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      await moduleRef.get(PluginRegistry).activate('crm');
      await expect(ctx.broadcast.toChannel('crm', 'synced', {})).resolves.toBeUndefined();
      await expect(ctx.broadcast.toUser(1, 'synced', {})).resolves.toBeUndefined();
      await expect(ctx.broadcast.toTicket(1, 'synced', {})).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
