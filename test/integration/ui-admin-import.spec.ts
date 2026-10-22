import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import manifest from '../fixtures/escalated-pages.json';
import {
  Contact,
  ImportJob,
  ImportSourceMap,
  Reply,
  Ticket,
  TicketStatus,
} from '../../src/entities';
import {
  ImportAdapter,
  ImportContext,
  ImportExtractResult,
} from '../../src/services/import-adapter';
import { ImportJobService } from '../../src/services/import-job.service';
import { ADMIN, bootUi, cookieFrom, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

const RECORDS: Record<string, Record<string, ImportExtractResult>> = {
  agents: {
    start: {
      records: [
        { source_id: 'a1', email: 'admin@example.com' },
        { source_id: 'a2', email: 'nobody@example.com' },
      ],
      cursor: null,
    },
  },
  contacts: {
    start: {
      records: [
        { source_id: 'c1', email: 'Ada@Example.com', name: 'Ada' },
        { source_id: 'c2', email: 'admin@example.com', name: 'Admin' },
      ],
      cursor: null,
    },
  },
  tags: { start: { records: [{ source_id: 'g1', name: 'Billing' }], cursor: null } },
  tickets: {
    start: {
      records: [
        {
          source_id: 't1',
          title: 'Login broken',
          description: 'Cannot sign in',
          status: 'resolved',
          priority: 'high',
          requester_source_id: 'c1',
          assignee_source_id: 'a1',
          tag_source_ids: ['g1'],
          created_at: '2024-01-02T03:04:05.000Z',
        },
        {
          source_id: 't2',
          title: 'Odd one',
          status: 'weird',
          priority: 'bogus',
          requester_source_id: 'c2',
        },
      ],
      cursor: 'p2',
      totalCount: 3,
    },
    p2: { records: [{ source_id: 't3', title: 'Third' }], cursor: null, totalCount: 3 },
  },
  replies: {
    start: {
      records: [
        { source_id: 'r1', ticket_source_id: 't1', body: 'Looking now', author_source_id: 'a1' },
        { source_id: 'r2', ticket_source_id: 't1', body: 'Thanks', author_source_id: 'c1' },
        { source_id: 'r3', ticket_source_id: 'missing', body: 'Orphan' },
      ],
      cursor: null,
    },
  },
};

/** A source with a few records; Escalated ships no adapter of its own. */
class FakeAdapter implements ImportAdapter {
  calls: Array<{ type: string; cursor: string | null; importing: boolean }> = [];
  afterBatch: ((type: string, cursor: string | null) => Promise<void>) | null = null;

  name() {
    return 'fake';
  }
  displayName() {
    return 'Fake Desk';
  }
  credentialFields() {
    return [{ name: 'token', label: 'API token', type: 'password', help: 'From settings' }];
  }
  testConnection(credentials: Record<string, string>) {
    if (credentials.token === 'boom') throw new Error('Source unreachable');
    return credentials.token === 'secret-token';
  }
  entityTypes() {
    return ['agents', 'contacts', 'tags', 'tickets', 'replies'];
  }
  defaultFieldMappings(type: string) {
    return type === 'tickets' ? { subject: 'title' } : {};
  }
  availableSourceFields(type: string, credentials: Record<string, string>) {
    return [
      { name: `${type}_field`, label: credentials.token ? 'Field' : '?', escalated_options: [] },
    ];
  }
  async extract(type: string, credentials: Record<string, string>, cursor: string | null) {
    if (credentials.token !== 'secret-token') throw new Error('Not authorized');
    this.calls.push({ type, cursor, importing: ImportContext.isImporting() });
    const result = RECORDS[type][cursor ?? 'start'];
    if (this.afterBatch) await this.afterBatch(type, cursor);
    return result;
  }
}

describe('admin import wizard (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let imports: ImportJobService;
  const adapter = new FakeAdapter();
  const asAdmin = { as: 'admin' as const };

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    inertiaFetch(base, path, {
      ...asAdmin,
      body,
      headers: { referer: `${base}/escalated/admin/import`, ...headers },
    });

  /** Connect's own fetch: JSON, without the Inertia headers. */
  const testConnection = (token: string, contentType = 'application/json') =>
    fetch(`${base}/escalated/admin/import/fake/test-connection`, {
      method: 'POST',
      headers: {
        'x-role': 'agent,admin,customer',
        'x-user': String(ADMIN),
        'content-type': contentType,
      },
      body: JSON.stringify({ credentials: { token } }),
    });

  const connected = async () => cookieFrom(await testConnection('secret-token'));

  const props = (component: string) =>
    ((manifest as any).props[component].props as string[]).slice().sort();

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      importAdapters: [adapter],
      importUserIdByEmail: (email) => (email === 'admin@example.com' ? ADMIN : null),
    }));
    imports = app.get(ImportJobService);
    await source.getRepository(TicketStatus).save([
      { name: 'Open', slug: 'open', isDefault: true, sortOrder: 1 },
      { name: 'Resolved', slug: 'resolved', category: 'solved', sortOrder: 2 },
    ]);
  });

  afterAll(async () => {
    await imports?.settled();
    await app?.close();
  });

  beforeEach(async () => {
    await imports.settled();
    adapter.calls = [];
    adapter.afterBatch = null;
    for (const entity of [Reply, ImportSourceMap, ImportJob, Contact]) {
      await source.getRepository(entity).clear();
    }
    await source.query('DELETE FROM escalated_ticket_tags');
    await source.getRepository(Ticket).createQueryBuilder().delete().execute();
  });

  it('keeps the wizard behind the admin guard', async () => {
    for (const path of ['/escalated/admin/import', '/escalated/admin/import/fake/connect']) {
      expect((await inertiaFetch(base, path, { as: 'agent' })).status).toBe(403);
    }
    const res = await fetch(`${base}/escalated/admin/import/fake/test-connection`, {
      method: 'POST',
      headers: { 'x-role': 'agent', 'x-user': '21', 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: { token: 'secret-token' } }),
    });
    expect(res.status).toBe(403);
  });

  it('lists the adapters and recent jobs on Index', async () => {
    const pageObject = await page(base, '/escalated/admin/import', asAdmin);
    expect(pageObject.component).toBe('Escalated/Admin/Import/Index');
    expect(Object.keys(pageObject.props)).toEqual(
      expect.arrayContaining(props(pageObject.component)),
    );
    expect(pageObject.props.adapters).toEqual([
      {
        name: 'fake',
        display_name: 'Fake Desk',
        credential_fields: [
          { name: 'token', label: 'API token', type: 'password', help: 'From settings' },
        ],
      },
    ]);
    expect(pageObject.props.jobs).toEqual([]);
  });

  it('shows Connect for a known platform and 404 for an unknown one', async () => {
    const pageObject = await page(base, '/escalated/admin/import/fake/connect', asAdmin);
    expect(pageObject.component).toBe('Escalated/Admin/Import/Connect');
    expect(pageObject.props).toMatchObject({ platform: 'fake', display_name: 'Fake Desk' });
    expect(Object.keys(pageObject.props)).toEqual(
      expect.arrayContaining(props(pageObject.component)),
    );
    const missing = await inertiaFetch(base, '/escalated/admin/import/nope/connect', asAdmin);
    expect(missing.status).toBe(404);
  });

  it('tests the connection and keeps working credentials sealed in a scoped cookie', async () => {
    const bad = await testConnection('wrong');
    expect(bad.status).toBe(200);
    expect(await bad.json()).toEqual({ success: false });
    expect(bad.headers.get('set-cookie')).toBeNull();

    const thrown = await testConnection('boom');
    expect(thrown.status).toBe(422);
    expect(await thrown.json()).toEqual({ success: false, error: 'Source unreachable' });

    // Another site's plain form cannot send JSON.
    expect((await testConnection('secret-token', 'application/x-www-form-urlencoded')).status).toBe(
      403,
    );

    const good = await testConnection('secret-token');
    expect(await good.json()).toEqual({ success: true });
    const header = good.headers.get('set-cookie')!;
    expect(header).toMatch(/^escalated_import=/);
    expect(header).toContain('Path=/escalated/admin/import');
    expect(header).toContain('HttpOnly');
    expect(header).not.toContain('secret-token');
  });

  it('sends Mapping back to Connect without tested credentials', async () => {
    const res = await inertiaFetch(base, '/escalated/admin/import/fake/mapping', asAdmin);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/escalated/admin/import/fake/connect');
  });

  it('maps fields with the tested credentials, never sending them to the page', async () => {
    const pageObject = await page(base, '/escalated/admin/import/fake/mapping', {
      ...asAdmin,
      headers: { cookie: await connected() },
    });
    expect(pageObject.component).toBe('Escalated/Admin/Import/Mapping');
    expect(Object.keys(pageObject.props)).toEqual(
      expect.arrayContaining(props(pageObject.component).filter((p) => p !== 'credentials')),
    );
    expect(pageObject.props).not.toHaveProperty('credentials');
    expect(JSON.stringify(pageObject)).not.toContain('secret-token');
    expect(pageObject.props.entity_types).toEqual(adapter.entityTypes());
    expect(pageObject.props.mappings.tickets).toEqual({
      defaults: { subject: 'title' },
      source_fields: [{ name: 'tickets_field', label: 'Field', escalated_options: [] }],
    });
  });

  it('reviews without writing anything', async () => {
    const res = await post('/escalated/admin/import/fake/review', {
      field_mappings: { tickets: { subject: 'title' } },
      entity_types: ['tickets', 'unknown'],
    });
    expect(res.status).toBe(200);
    const pageObject = await res.json();
    expect(pageObject.component).toBe('Escalated/Admin/Import/Review');
    expect(pageObject.props).toEqual(
      expect.objectContaining({
        platform: 'fake',
        field_mappings: { tickets: { subject: 'title' } },
        entity_types: ['tickets'],
      }),
    );
    expect(await source.getRepository(ImportJob).count()).toBe(0);
    expect(await source.getRepository(Ticket).count()).toBe(0);
  });

  it('starts an import that runs in import mode and imports the records end to end', async () => {
    const res = await post(
      '/escalated/admin/import/fake/start',
      { field_mappings: { tickets: { subject: 'title' } } },
      { cookie: await connected() },
    );
    expect(res.status).toBe(303);
    const location = res.headers.get('location')!;
    expect(location).toMatch(/^\/escalated\/admin\/import\/progress\/[0-9a-f-]{36}$/);
    expect(res.headers.get('set-cookie')).toMatch(/escalated_import=;.*Max-Age=0/);
    await imports.settled();

    const job = await source.getRepository(ImportJob).findOneByOrFail({});
    expect(job).toMatchObject({
      platform: 'fake',
      status: 'completed',
      userId: ADMIN,
      credentials: null,
      fieldMappings: { tickets: { subject: 'title' } },
    });
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(job.completedAt).toBeInstanceOf(Date);
    expect(job.progress!.tickets).toMatchObject({
      total: 3,
      processed: 3,
      failed: 0,
      cursor: 'p2',
    });
    expect(job.progress!.agents).toMatchObject({ processed: 1, failed: 1 });
    expect(job.errorLog!.map((e) => [e.entity_type, e.source_id])).toEqual([
      ['agents', 'a2'],
      ['replies', 'r3'],
    ]);
    expect(adapter.calls.every((call) => call.importing)).toBe(true);
    expect(ImportContext.isImporting()).toBe(false);

    const tickets = await source
      .getRepository(Ticket)
      .find({ relations: { tags: true, status: true }, order: { id: 'ASC' } });
    expect(tickets.map((t) => t.subject)).toEqual(['Login broken', 'Odd one', 'Third']);
    const ada = await source.getRepository(Contact).findOneByOrFail({ email: 'ada@example.com' });
    expect(tickets[0]).toMatchObject({
      description: 'Cannot sign in',
      priority: 'high',
      channel: 'import',
      contactId: ada.id,
      assigneeId: ADMIN,
    });
    expect(tickets[0].status.slug).toBe('resolved');
    expect(tickets[0].tags.map((t) => t.name)).toEqual(['Billing']);
    expect(tickets[0].createdAt.toISOString()).toBe('2024-01-02T03:04:05.000Z');
    // Laravel's tryFrom fallbacks, and a contact the host has as a user.
    expect(tickets[1]).toMatchObject({ priority: 'medium', requesterId: ADMIN, contactId: null });
    expect(tickets[1].status.slug).toBe('open');
    expect(tickets[2].description).toBe('Third');

    const replies = await source.getRepository(Reply).find({ order: { id: 'ASC' } });
    expect(replies.map((r) => [r.ticketId, r.body, r.userId])).toEqual([
      [tickets[0].id, 'Looking now', ADMIN],
      [tickets[0].id, 'Thanks', 0],
    ]);

    const status = await fetch(`${base}${location.replace('/progress/', '/status/')}`, {
      headers: { 'x-role': 'agent,admin,customer', 'x-user': String(ADMIN) },
    });
    const body = await status.json();
    expect(body).toMatchObject({ status: 'completed', progress: job.progress });
    expect(body.error_log).toHaveLength(2);
    expect(Object.keys(body).sort()).toEqual(
      ['completed_at', 'error_log', 'progress', 'started_at', 'status'].sort(),
    );

    const progress = await page(base, location, asAdmin);
    expect(progress.component).toBe('Escalated/Admin/Import/Progress');
    expect(progress.props.job).toMatchObject({ id: job.id, status: 'completed', platform: 'fake' });
    expect(progress.props.job).not.toHaveProperty('credentials');
  });

  it('pauses between batches and resumes without importing anything twice', async () => {
    adapter.afterBatch = async (type, cursor) => {
      if (type === 'tickets' && cursor === null) {
        await source.getRepository(ImportJob).update({ platform: 'fake' }, { status: 'paused' });
      }
    };
    const res = await post('/escalated/admin/import/fake/start', {}, { cookie: await connected() });
    const jobId = res.headers.get('location')!.split('/').pop()!;
    await imports.settled();

    let job = await source.getRepository(ImportJob).findOneByOrFail({ id: jobId });
    expect(job.status).toBe('paused');
    expect(job.credentials).not.toBeNull();
    expect(await source.getRepository(Ticket).count()).toBe(2);
    expect(job.progress!.tickets).toMatchObject({ processed: 2, cursor: 'p2' });

    adapter.afterBatch = null;
    const resumed = await post(`/escalated/admin/import/resume/${jobId}`, {});
    expect(resumed.status).toBe(303);
    await imports.settled();

    job = await source.getRepository(ImportJob).findOneByOrFail({ id: jobId });
    expect(job.status).toBe('completed');
    expect(await source.getRepository(Ticket).count()).toBe(3);
    expect(job.progress!.tickets).toMatchObject({ processed: 3 });
    // The resume picked tickets up from the saved cursor.
    expect(adapter.calls.filter((c) => c.type === 'tickets').map((c) => c.cursor)).toEqual([
      null,
      'p2',
    ]);
  });

  it('refuses to pause a job that is not importing, and cancels one, dropping its credentials', async () => {
    const res = await post('/escalated/admin/import/fake/start', {}, { cookie: await connected() });
    const jobId = res.headers.get('location')!.split('/').pop()!;
    await imports.settled();

    const pause = await post(`/escalated/admin/import/pause/${jobId}`, {});
    expect(pause.status).toBe(303);
    expect(decodeURIComponent(cookieFrom(pause))).toBeTruthy();
    expect((await source.getRepository(ImportJob).findOneByOrFail({ id: jobId })).status).toBe(
      'completed',
    );

    await source
      .getRepository(ImportJob)
      .update({ id: jobId }, { status: 'paused', credentials: 'x' });
    const cancel = await post(`/escalated/admin/import/cancel/${jobId}`, {});
    expect(cancel.status).toBe(303);
    const job = await source.getRepository(ImportJob).findOneByOrFail({ id: jobId });
    expect(job).toMatchObject({ status: 'failed', credentials: null });
    expect(job.completedAt).toBeInstanceOf(Date);

    // A cancelled job has no credentials left to resume with.
    const resume = await post(`/escalated/admin/import/resume/${jobId}`, {});
    expect(resume.status).toBe(303);
    expect((await source.getRepository(ImportJob).findOneByOrFail({ id: jobId })).status).toBe(
      'failed',
    );
  });

  it('refuses state changes another site could submit', async () => {
    const res = await fetch(`${base}/escalated/admin/import/fake/start`, {
      method: 'POST',
      headers: {
        'x-role': 'agent,admin,customer',
        'x-user': String(ADMIN),
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        cookie: await connected(),
      },
      body: 'field_mappings=',
    });
    expect(res.status).toBe(403);
    expect(await source.getRepository(ImportJob).count()).toBe(0);
  });
});
