import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { bootEscalatedModule } from './boot-escalated-module';
import { Attachment, Reply, SatisfactionRating, Ticket } from '../../src/entities';

jest.setTimeout(60000);

/**
 * Real HTTP + SQLite checks that customers only reach their own tickets'
 * attachments and ratings, and that agent routes never act as a default user.
 */

// The host guards read the caller from test headers.
const guardFor = (role: string): CanActivate => ({
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.headers['x-role'] !== role) return false;
    if (req.headers['x-user']) req.user = { id: Number(req.headers['x-user']) };
    return true;
  },
});

const CUSTOMER = 11;
const OTHER_CUSTOMER = 12;
const AGENT = 21;

describe('ticket ownership over HTTP', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let ticket: Ticket;
  let publicFile: Attachment;
  let noteFile: Attachment;

  const call = (
    method: string,
    path: string,
    who: { role: string; user?: number },
    body?: unknown,
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'x-role': who.role,
        ...(who.user ? { 'x-user': String(who.user) } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    const moduleRef = await bootEscalatedModule({
      escalated: {
        agentGuard: guardFor('agent'),
        customerGuard: guardFor('customer'),
      },
    });
    source = moduleRef.get(DataSource);
    await source.initialize();
    await source.synchronize();

    ticket = await source.getRepository(Ticket).save({
      referenceNumber: 'OWN-1',
      subject: 'Mine',
      description: 'Details',
      requesterId: CUSTOMER,
    });
    const note = await source.getRepository(Reply).save({
      ticketId: ticket.id,
      userId: AGENT,
      body: 'Internal',
      type: 'note',
      isInternal: true,
    });
    const dir = mkdtempSync(join(tmpdir(), 'esc-ownership-'));
    const file = join(dir, 'invoice.pdf');
    writeFileSync(file, 'customer file');
    publicFile = await source.getRepository(Attachment).save({
      ticketId: ticket.id,
      fileName: 'invoice.pdf',
      filePath: file,
      mimeType: 'application/pdf',
      fileSize: 13,
    });
    noteFile = await source.getRepository(Attachment).save({
      replyId: note.id,
      fileName: 'note.pdf',
      filePath: file,
      mimeType: 'application/pdf',
      fileSize: 13,
    });

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('attachment downloads', () => {
    const download = (id: number, who: { role: string; user?: number }) =>
      call('GET', `/escalated/attachments/${id}/download`, who);

    it("refuses another customer's attachment", async () => {
      const res = await download(publicFile.id, { role: 'customer', user: OTHER_CUSTOMER });
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('customer file');
    });

    it('serves the requester their own attachment', async () => {
      const res = await download(publicFile.id, { role: 'customer', user: CUSTOMER });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('customer file');
    });

    it('keeps internal-note attachments from the requester but not from agents', async () => {
      expect((await download(noteFile.id, { role: 'customer', user: CUSTOMER })).status).toBe(403);
      expect((await download(noteFile.id, { role: 'agent', user: AGENT })).status).toBe(200);
    });
  });

  describe('satisfaction ratings', () => {
    it("refuses a rating on another customer's ticket", async () => {
      const res = await call(
        'POST',
        `/escalated/customer/tickets/${ticket.id}/rate`,
        { role: 'customer', user: OTHER_CUSTOMER },
        { rating: 1 },
      );
      expect(res.status).toBe(403);
      expect(await source.getRepository(SatisfactionRating).count()).toBe(0);
    });

    it('accepts the requester rating their own ticket', async () => {
      const res = await call(
        'POST',
        `/escalated/customer/tickets/${ticket.id}/rate`,
        { role: 'customer', user: CUSTOMER },
        { rating: 5 },
      );
      expect(res.status).toBe(201);
    });
  });

  describe('agent identity', () => {
    it('answers 401 instead of acting as user 1 when the host guard sets no user', async () => {
      const res = await call(
        'POST',
        `/escalated/agent/tickets/${ticket.id}/replies`,
        { role: 'agent' },
        { body: 'Who am I?' },
      );
      expect(res.status).toBe(401);
      expect(await source.getRepository(Reply).countBy({ body: 'Who am I?' })).toBe(0);
    });

    it('acts as the authenticated agent', async () => {
      const res = await call(
        'POST',
        `/escalated/agent/tickets/${ticket.id}/replies`,
        { role: 'agent', user: AGENT },
        { body: 'Signed reply' },
      );
      expect(res.status).toBe(201);
      const reply = await source.getRepository(Reply).findOneByOrFail({ body: 'Signed reply' });
      expect(String(reply.userId)).toBe(String(AGENT));
    });
  });
});
