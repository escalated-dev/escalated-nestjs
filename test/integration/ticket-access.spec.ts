import { INestApplication, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';
import { bootEscalatedModule } from './boot-escalated-module';
import { TicketAccess, validateTicketAccess } from '../../src/config/ticket-access';
import { TicketService } from '../../src/services/ticket.service';
import { TicketSubjectService } from '../../src/services/ticket-subject.service';
import { AutomationService } from '../../src/services/automation.service';
import { EscalationService } from '../../src/services/escalation.service';
import { WorkflowEngineService } from '../../src/services/workflow-engine.service';
import { EscalatedGateway } from '../../src/gateway/escalated.gateway';
import { ApiTokenGuard } from '../../src/guards/api-token.guard';
import {
  Ticket,
  Department,
  AgentProfile,
  ApiToken,
  Reply,
  TicketLink,
  SlaPolicy,
} from '../../src/entities';

jest.setTimeout(60000);

// Hosts can expose token-authenticated routes over the same package services.
@Controller('ticket-access-api')
@UseGuards(ApiTokenGuard)
class AccessApi {
  constructor(
    private readonly tickets: TicketService,
    private readonly source: DataSource,
  ) {}
  @Get() list() {
    return this.tickets.findAll({});
  }
  @Get('report') report() {
    return this.source
      .getRepository(Ticket)
      .createQueryBuilder('ticket')
      .select('ticket.departmentId', 'department')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ticket.departmentId')
      .getRawMany();
  }
  @Post('bulk') bulk() {
    return this.source
      .getRepository(Ticket)
      .createQueryBuilder()
      .update()
      .set({ priority: 'high' })
      .where('1 = 1')
      .orWhere('1 = 1')
      .execute();
  }
}

describe('configurable ticket access over HTTP', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let visible: Ticket;
  let hidden: Ticket;
  let access: TicketAccess;

  beforeAll(async () => {
    const moduleRef = await bootEscalatedModule({
      database: process.env.ESCALATED_TEST_POSTGRES_URL
        ? { type: 'postgres', url: process.env.ESCALATED_TEST_POSTGRES_URL, dropSchema: true }
        : process.env.ESCALATED_TEST_MYSQL_URL
          ? { type: 'mysql', url: process.env.ESCALATED_TEST_MYSQL_URL, dropSchema: true }
          : undefined,
      host: { controllers: [AccessApi], providers: [ApiTokenGuard] },
      escalated: {
        visibility: 'department',
        ticketAccess: {
          resolveUser: async (id: number) => ({ id, isAgent: true, isAdmin: id === 9 }),
        },
        agentGuard: { canActivate: () => true },
      } as any,
    });
    source = moduleRef.get(DataSource);
    access = moduleRef.get(TicketAccess);
    await source.initialize();
    await source.synchronize();
    const departments = source.getRepository(Department);
    const own = await departments.save({ name: 'Own', slug: 'own' });
    const other = await departments.save({ name: 'Other', slug: 'other' });
    await source.getRepository(AgentProfile).save({ userId: 1, departments: [own] });
    const tickets = source.getRepository(Ticket);
    visible = await tickets.save({
      referenceNumber: 'ESC-1',
      subject: 'Visible',
      description: 'Details',
      requesterId: 2,
      departmentId: own.id,
    });
    hidden = await tickets.save({
      referenceNumber: 'ESC-2',
      subject: 'Hidden',
      description: 'Details',
      requesterId: 2,
      departmentId: other.id,
      assigneeId: 1,
      guestAccessToken: 'secret',
    });
    await source
      .getRepository(ApiToken)
      .save({ name: 'Visibility', token: 'private-api-token', userId: 1 });
    app = moduleRef.createNestApplication({ logger: false });
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { id: Number(req.headers['x-test-user'] || 1) };
      next();
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    if (app) await app.close();
    else if (source?.isInitialized) await source.destroy();
  });
  afterEach(async () => {
    if (!visible || !hidden) return;
    access.options.visibility = 'department';
    access.options.accounts = undefined;
    access.options.targetedSlas = false;
    await source.getRepository(TicketLink).clear();
    await source.getRepository(Ticket).delete({ id: Not(In([visible.id, hidden.id])) });
    await source.getRepository(Ticket).update([visible.id, hidden.id], {
      accountType: null,
      accountId: null,
      priority: 'medium',
      ticketType: 'question',
      slaPolicyId: null,
    });
  });

  it('scopes agent lists', async () => {
    const result = await fetch(`${base}/escalated/agent/tickets`);
    expect(result.status).toBe(200);
    expect((await result.json()).data.map((ticket: Ticket) => ticket.id)).toEqual([visible.id]);
  });

  it('scopes search', async () => {
    const result = await fetch(`${base}/escalated/agent/tickets?search=Hidden`);
    expect((await result.json()).total).toBe(0);
  });

  it('denies an update to an assigned ticket in another department', async () => {
    const result = await fetch(`${base}/escalated/agent/tickets/${hidden.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'Changed' }),
    });
    expect(result.status).toBe(404);
    expect((await source.getRepository(Ticket).findOneByOrFail({ id: hidden.id })).subject).toBe(
      'Hidden',
    );
  });

  it('scopes widget lookups even with a valid private token', async () => {
    const result = await fetch(`${base}/escalated/widget/tickets/${hidden.id}?guest_token=secret`);
    expect(result.status).toBe(404);
  });

  it('preserves administrator access', async () => {
    const result = await fetch(`${base}/escalated/agent/tickets`, {
      headers: { 'x-test-user': '9' },
    });
    expect((await result.json()).total).toBe(2);
  });

  it('scopes real token API lists', async () => {
    const response = await fetch(`${base}/ticket-access-api`, {
      headers: { authorization: 'Bearer private-api-token' },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.map((ticket: Ticket) => ticket.id)).toEqual([visible.id]);
  });

  it('scopes report aggregates', async () => {
    const response = await fetch(`${base}/ticket-access-api/report`, {
      headers: { authorization: 'Bearer private-api-token' },
    });
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(
      rows.map((row: any) => ({ department: Number(row.department), count: Number(row.count) })),
    ).toEqual([{ department: visible.departmentId, count: 1 }]);
  });

  it('scopes bulk writes even when the caller uses an OR predicate', async () => {
    const response = await fetch(`${base}/ticket-access-api/bulk`, {
      method: 'POST',
      headers: { authorization: 'Bearer private-api-token' },
    });
    expect(response.status).toBe(201);
    expect((await source.getRepository(Ticket).findOneByOrFail({ id: visible.id })).priority).toBe(
      'high',
    );
    expect((await source.getRepository(Ticket).findOneByOrFail({ id: hidden.id })).priority).toBe(
      'medium',
    );
  });

  it('denies replies and direct detail, while preserving legacy access when disabled', async () => {
    expect((await fetch(`${base}/escalated/agent/tickets/${hidden.id}`)).status).toBe(404);
    expect(
      (
        await fetch(`${base}/escalated/agent/tickets/${hidden.id}/replies`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: 'Private' }),
        })
      ).status,
    ).toBe(404);
    access.options.visibility = 'all';
    expect((await fetch(`${base}/escalated/agent/tickets/${hidden.id}`)).status).toBe(200);
  });

  it('scopes child records and both ends of links', async () => {
    await source.getRepository(Reply).save({ ticketId: hidden.id, body: 'Secret', userId: 2 });
    await source
      .getRepository(TicketLink)
      .save({ ticketId: visible.id, linkedTicketId: hidden.id });
    await access.withActor({ id: 1, isAgent: true, isAdmin: false }, async () => {
      expect(await source.getRepository(Reply).count()).toBe(0);
      expect(await source.getRepository(TicketLink).count()).toBe(0);
    });
  });

  it('isolates concurrent actors and resets the background context', async () => {
    const counts = await Promise.all(
      [1, 9, 8].map((id) =>
        access.withActor({ id, isAgent: true, isAdmin: id === 9 }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return source.getRepository(Ticket).count();
        }),
      ),
    );
    expect(counts).toEqual([1, 2, 0]);
    expect(await source.getRepository(Ticket).count()).toBe(2);
  });

  it('intersects account and department and compares account type and id case', async () => {
    access.options.accounts = {
      enabled: true,
      scopeAgents: true,
      resolver: () => ({ type: 'Company', id: 'North' }),
    };
    await source
      .getRepository(Ticket)
      .update([visible.id, hidden.id], { accountType: 'Company', accountId: 'North' });
    await source.getRepository(Ticket).save({
      referenceNumber: 'ESC-3',
      subject: 'Other account',
      description: 'Details',
      requesterId: 2,
      departmentId: visible.departmentId,
      accountType: 'Company',
      accountId: 'north',
    });
    const response = await fetch(`${base}/escalated/agent/tickets`);
    expect((await response.json()).data.map((ticket: Ticket) => ticket.id)).toEqual([visible.id]);
    access.options.accounts.resolver = () => ({ type: 'Partner', id: 'North' });
    expect((await (await fetch(`${base}/escalated/agent/tickets`)).json()).total).toBe(0);
    access.options.accounts.resolver = () => null;
    expect((await (await fetch(`${base}/escalated/agent/tickets`)).json()).total).toBe(0);
  });

  it('resolves requester and subject accounts without overwriting through stale objects', async () => {
    access.options.accounts = {
      enabled: true,
      resolver: (reference) =>
        reference.kind === 'requester'
          ? { type: 'Company', id: 'first' }
          : { type: 'Company', id: reference.id },
    };
    const ticket = await app
      .get(TicketService)
      .create({ subject: 'Account', description: 'Details' }, 2);
    expect(ticket.accountId).toBe('first');
    await app.get(TicketSubjectService).attach(visible, 'Shipment', 'subject-account');
    await app
      .get(TicketSubjectService)
      .attach({ ...visible, accountType: null, accountId: null } as Ticket, 'Shipment', 'second');
    expect((await source.getRepository(Ticket).findOneByOrFail({ id: visible.id })).accountId).toBe(
      'subject-account',
    );
  });

  it('validates account filters and preserves exact-case matching', async () => {
    access.options.accounts = { enabled: true };
    await source
      .getRepository(Ticket)
      .update(visible.id, { accountType: 'Company', accountId: 'North' });
    expect((await fetch(`${base}/escalated/agent/tickets?accountId=North`)).status).toBe(400);
    expect(
      (
        await (
          await fetch(`${base}/escalated/agent/tickets?accountType=Company&accountId=north`)
        ).json()
      ).total,
    ).toBe(0);
  });

  it('selects targeted SLAs by specificity and retains the clock after a department change', async () => {
    access.options.targetedSlas = true;
    const policies = source.getRepository(SlaPolicy);
    await policies.save({ name: 'Default', isDefault: true });
    await policies.save({ name: 'Type', ticketType: 'incident' });
    await policies.save({ name: 'Department', departmentId: visible.departmentId });
    const both = await policies.save({
      name: 'Both',
      ticketType: 'incident',
      departmentId: visible.departmentId,
    });
    const ticket = await app.get(TicketService).create(
      {
        subject: 'Incident',
        description: 'Details',
        ticketType: 'incident',
        departmentId: visible.departmentId,
      },
      2,
    );
    expect(ticket.slaPolicyId).toBe(both.id);
    const updated = await app
      .get(TicketService)
      .update(ticket.id, { departmentId: hidden.departmentId }, 1);
    expect(updated.slaPolicyId).toBe(both.id);
    expect(updated.firstResponseDueAt).toEqual(ticket.firstResponseDueAt);
  });

  it('routes by complete account and type in all three rule engines', async () => {
    await source
      .getRepository(Ticket)
      .update(visible.id, { accountType: 'Company', accountId: 'North', ticketType: 'incident' });
    await source
      .getRepository(Ticket)
      .update(hidden.id, { accountType: 'Partner', accountId: 'North', ticketType: 'incident' });
    const conditions = [
      { field: 'account', operator: 'equals', value: { type: 'Company', id: 'North' } },
      { field: 'ticket_type', operator: 'equals', value: 'incident' },
    ];
    const matches = await (app.get(AutomationService) as any).findMatchingTickets({ conditions });
    expect(matches.map((ticket: Ticket) => ticket.id)).toEqual([visible.id]);
    const engine = app.get(WorkflowEngineService);
    expect(
      engine.evaluateConditions(conditions, {
        accountType: 'Company',
        accountId: 'North',
        ticketType: 'incident',
      }),
    ).toBe(true);
    expect(
      engine.evaluateConditions(
        [{ field: 'account', operator: 'not_equals', value: { id: 'North' } }],
        {},
      ),
    ).toBe(false);
    const policy = await source.getRepository(SlaPolicy).save({ name: 'Rule target' });
    await source.getRepository(Ticket).update([visible.id, hidden.id], { slaPolicyId: policy.id });
    const result = await (app.get(EscalationService) as any).getEscalationCandidates(
      {
        slaPolicyId: policy.id,
        conditions: { account: { type: 'Company', id: 'North' }, ticket_type: 'incident' },
      },
      new Date(),
    );
    expect(result.map((ticket: Ticket) => ticket.id)).toEqual([visible.id]);
  });

  it('validates opt-in configuration before boot', () => {
    expect(() => validateTicketAccess({ visibility: 'department' })).toThrow('resolveUser');
    expect(() =>
      validateTicketAccess({
        accounts: { scopeAgents: true },
        ticketAccess: { resolveUser: async (id) => ({ id, isAgent: true, isAdmin: false }) },
      }),
    ).toThrow('enabled accounts');
    expect(() => validateTicketAccess({})).not.toThrow();
  });

  it('checks each broadcast delivery against current membership', async () => {
    const gateway = new EscalatedGateway(access);
    const client = {
      data: { escalatedUserId: 1 },
      rooms: new Set([`ticket:${visible.id}`]),
      emit: jest.fn(),
    };
    gateway.server = { fetchSockets: async () => [client] } as any;
    await (gateway as any).deliverScoped(undefined, 'ticket:created', { ticket: hidden });
    expect(client.emit).not.toHaveBeenCalled();
    await (gateway as any).deliverScoped(undefined, 'ticket:created', { ticket: visible });
    expect(client.emit).toHaveBeenCalledTimes(1);
    const profile = await source.getRepository(AgentProfile).findOneByOrFail({ userId: 1 });
    await source.getRepository(AgentProfile).save({ ...profile, departments: [] });
    await (gateway as any).deliverScoped(`ticket:${visible.id}`, 'ticket:updated', {
      ticket: visible,
    });
    expect(client.emit).toHaveBeenCalledTimes(1);
    await source
      .getRepository(AgentProfile)
      .save({ ...profile, departments: [{ id: visible.departmentId }] });
  });
});
