import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentNotification, AgentProfile, Ticket } from '../../src/entities';
import { ReplyService } from '../../src/services/reply.service';
import { TicketService } from '../../src/services/ticket.service';
import { AGENT, apiFetch, bootUi, CUSTOMER } from './ui-harness';

jest.setTimeout(60000);

/**
 * @mentions (escalated-laravel's MentionService and AgentSearchController):
 * agents mentioned in an agent's reply or note get a `mention` notification,
 * and the composer's picker searches agents at `admin/agents/search`.
 */

const ALICE = 41;
const BOB = 42;

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 50 && !done(value); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

describe('agent @mentions', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let tickets: TicketService;
  let replies: ReplyService;

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: {
        enabled: true,
        version: 'v1',
        resolveUsers: (ids) =>
          ids
            .filter((id) => String(id) === String(BOB))
            .map((id) => ({ id, name: 'Bob Smith', email: 'bob@example.com' })),
      },
    }));
    tickets = app.get(TicketService);
    replies = app.get(ReplyService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const profiles = source.getRepository(AgentProfile);
    await profiles.save([
      { userId: AGENT, displayName: 'Agent Smith', isActive: true },
      { userId: ALICE, displayName: 'alice', isActive: true },
      { userId: BOB, displayName: 'Robert', isActive: true },
      { userId: 43, displayName: 'Gone Agent', isActive: false },
    ]);
  });

  afterEach(async () => {
    await source.getRepository(AgentNotification).clear();
    await source.getRepository(Ticket).createQueryBuilder().delete().execute();
    await source.getRepository(AgentProfile).createQueryBuilder().delete().execute();
  });

  const notifications = (user: number) =>
    source.getRepository(AgentNotification).find({ where: { userId: user } as any });

  const settled = (user: number, count = 1) =>
    eventually(
      () => notifications(user),
      (rows) => rows.length >= count,
    );

  it('notifies agents mentioned in an internal note, by @name and @{Full Name}', async () => {
    const ticket = await tickets.create(
      { subject: 'Help', description: 'Please' } as any,
      CUSTOMER,
    );
    await replies.create(
      ticket.id,
      { body: 'Ping @alice and @{Bob Smith} please', isInternal: true, type: 'note' } as any,
      AGENT,
    );

    const [alice] = await settled(ALICE);
    const [bob] = await settled(BOB);
    expect(alice.type).toBe('mention');
    expect(bob.type).toBe('mention');
    expect(alice.data).toMatchObject({
      ticket_id: ticket.id,
      reference: ticket.referenceNumber,
      mentioned_by: 'Agent Smith',
    });

    const res = await fetch(`${base}/escalated/agent/notifications`, {
      headers: { accept: 'application/json', 'x-role': 'agent', 'x-user': String(ALICE) },
    });
    const body = await res.json();
    expect(body.data[0]).toMatchObject({
      type: 'mention',
      title: `Agent Smith mentioned you on ${ticket.referenceNumber}`,
      ticket: { id: ticket.id, reference: ticket.referenceNumber },
    });
  });

  it('notifies agents mentioned in an agent reply, case-insensitively', async () => {
    const ticket = await tickets.create(
      { subject: 'Help', description: 'Please' } as any,
      CUSTOMER,
    );
    await replies.create(ticket.id, { body: 'cc @ALICE, thanks', type: 'reply' } as any, AGENT);
    expect((await settled(ALICE)).map((row) => row.type)).toEqual(['mention']);
  });

  it('does not notify the author, inactive agents, unknown names or customer replies', async () => {
    const ticket = await tickets.create(
      { subject: 'Help', description: 'Please' } as any,
      CUSTOMER,
    );
    await replies.create(
      ticket.id,
      { body: '@{Agent Smith} @{Gone Agent} @nobody', isInternal: true, type: 'note' } as any,
      AGENT,
    );
    await replies.create(ticket.id, { body: 'Hi @alice', type: 'reply' } as any, CUSTOMER);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await source.getRepository(AgentNotification).count()).toBe(0);
  });

  it('lists agents for the mention picker by name or email', async () => {
    const res = await apiFetch(base, '/escalated/admin/agents/search?q=bob', { as: 'admin' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: BOB, name: 'Bob Smith', email: 'bob@example.com' }]);

    const byName = await apiFetch(base, '/escalated/admin/agents/search?q=ALI', { as: 'admin' });
    expect(await byName.json()).toEqual([{ id: ALICE, name: 'alice', email: null }]);

    const empty = await apiFetch(base, '/escalated/admin/agents/search?q=', { as: 'admin' });
    expect(await empty.json()).toEqual([]);

    const inactive = await apiFetch(base, '/escalated/admin/agents/search?q=gone', { as: 'admin' });
    expect(await inactive.json()).toEqual([]);
  });

  it('keeps the mention picker to admins, as escalated-laravel', async () => {
    const res = await apiFetch(base, '/escalated/admin/agents/search?q=bob', { as: 'agent' });
    expect(res.status).toBe(403);
  });
});
