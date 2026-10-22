import { DataSource, DataSourceOptions } from 'typeorm';
import * as entities from '../../src/entities';
import {
  Attachment,
  AuditLog,
  ChatSession,
  CustomField,
  CustomFieldValue,
  EscalatedSettings,
  GuestVerification,
  InboundEmail,
  Reply,
  SatisfactionRating,
  SideConversation,
  SideConversationReply,
  Ticket,
  TicketFollower,
  TicketLink,
  TicketStatus,
  Workflow,
  WorkflowLog,
} from '../../src/entities';
import { DataRetentionService, retentionDays } from '../../src/services/data-retention.service';
import { SettingsService } from '../../src/services/settings.service';

jest.setTimeout(120000);

/**
 * The data retention purge (escalated-laravel's `escalated:purge-expired`) on
 * every database the README promises: SQLite always, PostgreSQL and MySQL when
 * ESCALATED_TEST_POSTGRES_URL / ESCALATED_TEST_MYSQL_URL point at throwaway
 * databases (their schema is dropped).
 */
const databases: Array<[string, DataSourceOptions]> = [
  ['SQLite', { type: 'better-sqlite3', database: ':memory:' }],
];
if (process.env.ESCALATED_TEST_POSTGRES_URL)
  databases.push([
    'PostgreSQL',
    { type: 'postgres', url: process.env.ESCALATED_TEST_POSTGRES_URL, dropSchema: true },
  ]);
if (process.env.ESCALATED_TEST_MYSQL_URL)
  databases.push([
    'MySQL',
    { type: 'mysql', url: process.env.ESCALATED_TEST_MYSQL_URL, dropSchema: true },
  ]);

const DAY = 86_400_000;

describe('retention day map', () => {
  it("maps Laravel's values, and never or anything else to none", () => {
    expect(retentionDays('never')).toBeNull();
    expect(retentionDays('bogus')).toBeNull();
    expect(retentionDays(undefined)).toBeNull();
    expect(retentionDays('90_days')).toBe(90);
    expect(retentionDays('1_year')).toBe(365);
    expect(retentionDays('3_years')).toBe(1095);
    expect(retentionDays('5_years')).toBe(1825);
  });
});

describe.each(databases)('data retention purge on %s', (_name, options) => {
  let source: DataSource;
  let settings: SettingsService;
  let retention: DataRetentionService;
  let closed: TicketStatus;
  let open: TicketStatus;
  let resolved: TicketStatus;
  let n = 0;
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  beforeAll(async () => {
    source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      synchronize: true,
    } as DataSourceOptions);
    await source.initialize();
    settings = new SettingsService(source.getRepository(EscalatedSettings));
    retention = new DataRetentionService(settings, source.getRepository(Ticket));
    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
    resolved = await statuses.save({ name: 'Resolved', slug: 'resolved', isClosed: true });
    closed = await statuses.save({ name: 'Closed', slug: 'closed', isClosed: true });
  });

  afterAll(async () => {
    await source?.destroy();
  });

  beforeEach(async () => {
    for (const key of ['retention_closed_tickets', 'retention_attachments', 'retention_audit_logs'])
      await settings.set(key, 'never');
  });

  const ticket = async (status: TicketStatus, closedAt: Date | null) =>
    source.getRepository(Ticket).save({
      referenceNumber: `RET-${++n}`,
      subject: `Retention ${n}`,
      description: 'x',
      requesterId: 300,
      statusId: status.id,
      closedAt,
    } as Partial<Ticket>);

  const exists = (id: number) => source.getRepository(Ticket).existsBy({ id });

  it('leaves everything alone while every period is never', async () => {
    const old = await ticket(closed, ago(10 * 365));
    const report = await retention.purgeExpired({ now });
    expect(report.closedTickets).toBe(0);
    expect(await exists(old.id)).toBe(true);
    expect(await retention.preview(now)).toEqual({ tickets: 0, attachments: 0, audit_logs: 0 });
    await source.getRepository(Ticket).delete(old.id);
  });

  it('deletes a closed ticket past its period with every row pointing at it', async () => {
    await settings.set('retention_closed_tickets', '5_years');
    const expired = await ticket(closed, ago(6 * 365));
    const recent = await ticket(closed, ago(30));
    const stillOpen = await ticket(open, ago(6 * 365));
    const wasResolved = await ticket(resolved, ago(6 * 365));
    await source.getRepository(Ticket).update(stillOpen.id, { mergedIntoTicketId: expired.id });

    const reply = await source
      .getRepository(Reply)
      .save({ ticketId: expired.id, body: 'hello', userId: 1 } as Partial<Reply>);
    await source.getRepository(Attachment).save({
      ticketId: expired.id,
      replyId: reply.id,
      fileName: 'a.txt',
      filePath: 'a',
      mimeType: 'text/plain',
      fileSize: 1,
    } as Partial<Attachment>);
    await source
      .getRepository(SatisfactionRating)
      .save({ ticketId: expired.id, customerId: 300, rating: 5 } as Partial<SatisfactionRating>);
    await source
      .getRepository(TicketFollower)
      .save({ ticketId: expired.id, userId: 7 } as Partial<TicketFollower>);
    await source
      .getRepository(TicketLink)
      .save({ ticketId: recent.id, linkedTicketId: expired.id } as Partial<TicketLink>);
    await source
      .getRepository(ChatSession)
      .save({ ticketId: expired.id, lastActivityAt: now } as Partial<ChatSession>);
    const aside = await source
      .getRepository(SideConversation)
      .save({ ticketId: expired.id, subject: 'aside', createdBy: 1 } as Partial<SideConversation>);
    await source.getRepository(SideConversationReply).save({
      sideConversationId: aside.id,
      body: 'r',
      userId: 1,
    } as Partial<SideConversationReply>);
    const field = await source
      .getRepository(CustomField)
      .save({ name: `Order ${n}`, slug: `order-${n}`, fieldType: 'text' } as Partial<CustomField>);
    await source.getRepository(CustomFieldValue).save({
      customFieldId: field.id,
      entityType: 'ticket',
      entityId: expired.id,
      value: 'v',
    } as Partial<CustomFieldValue>);
    const workflow = await source.getRepository(Workflow).save({
      name: 'wf',
      triggerEvent: 'ticket.created',
      conditions: {},
      actions: [],
    } as Partial<Workflow>);
    await source.getRepository(WorkflowLog).save({
      workflow,
      ticket: expired,
      triggerEvent: 'ticket.created',
    } as Partial<WorkflowLog>);
    await source.getRepository(InboundEmail).save({
      provider: 'postmark',
      matchedTicketId: expired.id,
      outcome: 'reply_added',
    } as Partial<InboundEmail>);

    expect((await retention.preview(now)).tickets).toBe(1);
    const dry = await retention.purgeExpired({ dryRun: true, now });
    expect(dry.closedTickets).toBe(1);
    expect(await exists(expired.id)).toBe(true);

    const report = await retention.purgeExpired({ now });
    expect(report.closedTickets).toBe(1);
    expect(await exists(expired.id)).toBe(false);
    for (const kept of [recent, stillOpen, wasResolved]) expect(await exists(kept.id)).toBe(true);
    expect(await source.getRepository(Reply).countBy({ ticketId: expired.id })).toBe(0);
    expect(await source.getRepository(Attachment).countBy({ ticketId: expired.id })).toBe(0);
    expect(await source.getRepository(SatisfactionRating).countBy({ ticketId: expired.id })).toBe(
      0,
    );
    expect(await source.getRepository(TicketFollower).countBy({ ticketId: expired.id })).toBe(0);
    expect(await source.getRepository(TicketLink).countBy({ linkedTicketId: expired.id })).toBe(0);
    expect(await source.getRepository(ChatSession).countBy({ ticketId: expired.id })).toBe(0);
    expect(await source.getRepository(SideConversation).countBy({ ticketId: expired.id })).toBe(0);
    expect(
      await source.getRepository(SideConversationReply).countBy({ sideConversationId: aside.id }),
    ).toBe(0);
    expect(
      await source
        .getRepository(CustomFieldValue)
        .countBy({ entityType: 'ticket', entityId: expired.id }),
    ).toBe(0);
    expect(await source.getRepository(WorkflowLog).count()).toBe(0);
    expect(
      (await source.getRepository(InboundEmail).findOneByOrFail({})).matchedTicketId,
    ).toBeNull();
    expect(
      (await source.getRepository(Ticket).findOneByOrFail({ id: stillOpen.id })).mergedIntoTicketId,
    ).toBeNull();
  });

  it('deletes attachments, audit logs and expired guest codes past their cutoffs', async () => {
    await settings.set('retention_attachments', '1_year');
    await settings.set('retention_audit_logs', '90_days');
    const owner = await ticket(open, null);
    const attachments = source.getRepository(Attachment);
    const old = await attachments.save({
      ticketId: owner.id,
      fileName: 'old.txt',
      filePath: 'old',
      mimeType: 'text/plain',
      fileSize: 1,
    } as Partial<Attachment>);
    const fresh = await attachments.save({
      ticketId: owner.id,
      fileName: 'new.txt',
      filePath: 'new',
      mimeType: 'text/plain',
      fileSize: 1,
    } as Partial<Attachment>);
    await attachments.update(old.id, { createdAt: ago(2 * 365) });
    const logs = source.getRepository(AuditLog);
    const oldLog = await logs.save({
      action: 'updated',
      entityType: 'ticket',
      entityId: 1,
    } as Partial<AuditLog>);
    const freshLog = await logs.save({
      action: 'updated',
      entityType: 'ticket',
      entityId: 1,
    } as Partial<AuditLog>);
    await logs.update(oldLog.id, { createdAt: ago(100) });
    const codes = source.getRepository(GuestVerification);
    const code = (expiresAt: Date) =>
      codes.save({
        id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
        emailDigest: `e${n}`,
        purpose: 'ticket',
        codeHash: 'h',
        expiresAt,
      } as Partial<GuestVerification>);
    const expiredCode = await code(new Date(now.getTime() - 60_000));
    const liveCode = await code(new Date(now.getTime() + 600_000));

    expect(await retention.preview(now)).toEqual({ tickets: 0, attachments: 1, audit_logs: 1 });
    const dry = await retention.purgeExpired({ dryRun: true, now });
    expect([dry.attachments, dry.auditLogs, dry.guestVerifications]).toEqual([1, 1, 1]);
    expect(await attachments.existsBy({ id: old.id })).toBe(true);
    expect(await codes.existsBy({ id: expiredCode.id })).toBe(true);

    const report = await retention.purgeExpired({ now });
    expect([report.attachments, report.auditLogs, report.guestVerifications]).toEqual([1, 1, 1]);
    expect(await attachments.existsBy({ id: old.id })).toBe(false);
    expect(await attachments.existsBy({ id: fresh.id })).toBe(true);
    expect(await logs.existsBy({ id: oldLog.id })).toBe(false);
    expect(await logs.existsBy({ id: freshLog.id })).toBe(true);
    expect(await codes.existsBy({ id: expiredCode.id })).toBe(false);
    expect(await codes.existsBy({ id: liveCode.id })).toBe(true);
    expect(await exists(owner.id)).toBe(true);
  });
});
