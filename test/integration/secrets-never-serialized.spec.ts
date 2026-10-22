import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentProfile, ApiToken, ImportJob, Webhook, WebhookDelivery } from '../../src/entities';
import type { ImportAdapter } from '../../src/services/import-adapter';
import { ImportJobService } from '../../src/services/import-job.service';
import { ADMIN, apiFetch, bootUi, cookieFrom, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/*
 * Stored secrets never reach the browser.
 *
 * Import source credentials, webhook signing secrets, API token values and
 * two-factor seeds are kept server-side so the app can use them. None of them
 * is shown back to an admin: every page and JSON response that carries one of
 * these records is checked here for the raw secret anywhere in the body.
 */

const IMPORT_API_KEY = 'imp-key-7f3a9c2e5b1d';
const IMPORT_PASSWORD = 'imp-pass-q8w7e6r5t4';
const WEBHOOK_SECRET = 'whsec-4c8e1a7b9d3f';
const TOTP_SECRET = 'TOTPSECRETBASE32XX';
const RECOVERY_CODE = 'RC-AAAA-BBBB';

class LeakTestAdapter implements ImportAdapter {
  name() {
    return 'fakedesk';
  }
  displayName() {
    return 'FakeDesk';
  }
  credentialFields() {
    return [
      { name: 'api_key', label: 'API key', type: 'password', help: '' },
      { name: 'password', label: 'Password', type: 'password', help: '' },
    ];
  }
  testConnection(credentials: Record<string, string>) {
    return credentials.api_key === IMPORT_API_KEY;
  }
  entityTypes() {
    return ['tickets'];
  }
  defaultFieldMappings() {
    return { subject: 'subject' };
  }
  availableSourceFields() {
    return [{ name: 'subject', label: 'Subject', escalated_options: [] }];
  }
  async extract() {
    return { records: [], cursor: null };
  }
}

describe('stored secrets are never serialized', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let imports: ImportJobService;
  const asAdmin = { as: 'admin' as const };

  const expectNoSecrets = (body: string, secrets: string[]) => {
    for (const secret of secrets) expect(body).not.toContain(secret);
  };

  const bodyOf = async (res: Response) => {
    expect(res.status).toBeLessThan(400);
    return res.text();
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({ importAdapters: [new LeakTestAdapter()] }));
    imports = app.get(ImportJobService);
  });

  afterAll(async () => {
    await imports?.settled();
    await app?.close();
  });

  // --- Import ----------------------------------------------------------------

  describe('import jobs', () => {
    const credentials = { api_key: IMPORT_API_KEY, password: IMPORT_PASSWORD };
    let job: ImportJob;
    let sealed: string;

    beforeAll(async () => {
      sealed = imports.credentials.seal(credentials);
      job = await source.getRepository(ImportJob).save(
        source.getRepository(ImportJob).create({
          userId: ADMIN,
          platform: 'fakedesk',
          status: 'importing',
          credentials: sealed,
          progress: { tickets: { total: 10, processed: 4, skipped: 0, failed: 0, cursor: null } },
          errorLog: [],
        }),
      );
    });

    it('keeps credentials out of the import index page', async () => {
      const res = await inertiaFetch(base, '/escalated/admin/import', asAdmin);
      const body = await bodyOf(res);
      expectNoSecrets(body, [IMPORT_API_KEY, IMPORT_PASSWORD, sealed]);
      const jobs = JSON.parse(body).props.jobs;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ id: job.id, platform: 'fakedesk', status: 'importing' });
      expect(jobs[0]).toHaveProperty('created_at');
      expect(jobs[0]).not.toHaveProperty('credentials');
    });

    it('keeps credentials out of the import progress page', async () => {
      const res = await inertiaFetch(base, `/escalated/admin/import/progress/${job.id}`, asAdmin);
      const body = await bodyOf(res);
      expectNoSecrets(body, [IMPORT_API_KEY, IMPORT_PASSWORD, sealed]);
      const props = JSON.parse(body).props.job;
      expect(props).toMatchObject({ id: job.id, status: 'importing', platform: 'fakedesk' });
      expect(props.progress.tickets.processed).toBe(4);
      expect(props).toHaveProperty('error_log');
      expect(props).not.toHaveProperty('credentials');
    });

    it('keeps credentials out of the import status json', async () => {
      const res = await apiFetch(base, `/escalated/admin/import/status/${job.id}`, asAdmin);
      const body = await bodyOf(res);
      expectNoSecrets(body, [IMPORT_API_KEY, IMPORT_PASSWORD, sealed]);
      expect(JSON.parse(body).status).toBe('importing');
    });

    it('keeps credentials out of the connect, test-connection, mapping and review steps', async () => {
      const connect = await inertiaFetch(base, '/escalated/admin/import/fakedesk/connect', asAdmin);
      expectNoSecrets(await bodyOf(connect), [IMPORT_API_KEY, IMPORT_PASSWORD]);

      const test = await fetch(`${base}/escalated/admin/import/fakedesk/test-connection`, {
        method: 'POST',
        headers: {
          'x-role': 'agent,admin,customer',
          'x-user': String(ADMIN),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ credentials }),
      });
      const testBody = await bodyOf(test);
      expect(JSON.parse(testBody).success).toBe(true);
      expectNoSecrets(testBody, [IMPORT_API_KEY, IMPORT_PASSWORD]);
      const cookie = cookieFrom(test);
      expectNoSecrets(cookie, [IMPORT_API_KEY, IMPORT_PASSWORD]);

      const mapping = await inertiaFetch(base, '/escalated/admin/import/fakedesk/mapping', {
        ...asAdmin,
        headers: { cookie },
      });
      const mappingBody = await bodyOf(mapping);
      expect(JSON.parse(mappingBody).component).toBe('Escalated/Admin/Import/Mapping');
      expectNoSecrets(mappingBody, [IMPORT_API_KEY, IMPORT_PASSWORD]);

      const review = await inertiaFetch(base, '/escalated/admin/import/fakedesk/review', {
        ...asAdmin,
        body: { entity_types: ['tickets'] },
        headers: { cookie, referer: `${base}/escalated/admin/import` },
      });
      expectNoSecrets(await bodyOf(review), [IMPORT_API_KEY, IMPORT_PASSWORD]);
    });

    it('still hands the stored credentials to the import run server-side', async () => {
      const stored = await source.getRepository(ImportJob).findOneByOrFail({ id: job.id });
      expect(imports.credentials.open(stored.credentials)).toEqual(credentials);
      expect(JSON.parse(JSON.stringify(stored))).not.toHaveProperty('credentials');
      expect(JSON.stringify(stored)).not.toContain(sealed);
    });
  });

  // --- Webhooks --------------------------------------------------------------

  describe('webhooks', () => {
    const realFetch = global.fetch;

    beforeAll(() => {
      // Webhook saves check the URL resolves publicly; keep deliveries off the network.
      jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = String(input?.url ?? input);
        if (url.startsWith(base)) return realFetch(input, init);
        return Promise.resolve(new Response('ok', { status: 200 }));
      });
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    const webhookWithSecret = async () => {
      const webhook = await source.getRepository(Webhook).save(
        source.getRepository(Webhook).create({
          name: 'Hooks',
          url: 'https://1.1.1.1/escalated',
          events: ['ticket.created'],
          secret: WEBHOOK_SECRET,
          isActive: true,
        }),
      );
      await source.getRepository(WebhookDelivery).save({
        webhookId: webhook.id,
        event: 'ticket.created',
        payload: JSON.stringify({ ok: true }),
        status: 'success',
        responseStatus: 200,
        attempts: 1,
      });
      return webhook;
    };

    const storedSecret = async (id: number) =>
      (await source.getRepository(Webhook).findOneByOrFail({ id })).secret;

    beforeEach(async () => {
      await source.getRepository(WebhookDelivery).clear();
      await source.getRepository(Webhook).clear();
    });

    it('keeps the secret out of the webhook index, edit and delivery-log pages', async () => {
      const webhook = await webhookWithSecret();

      const index = await bodyOf(await inertiaFetch(base, '/escalated/admin/webhooks', asAdmin));
      expectNoSecrets(index, [WEBHOOK_SECRET]);
      expect(JSON.parse(index).props.webhooks[0].has_secret).toBe(true);

      const edit = await bodyOf(
        await inertiaFetch(base, `/escalated/admin/webhooks/${webhook.id}/edit`, asAdmin),
      );
      expectNoSecrets(edit, [WEBHOOK_SECRET]);
      expect(JSON.parse(edit).props.webhook).toMatchObject({
        has_secret: true,
        url: 'https://1.1.1.1/escalated',
      });

      const log = await bodyOf(
        await inertiaFetch(base, `/escalated/admin/webhooks/${webhook.id}/deliveries`, asAdmin),
      );
      expectNoSecrets(log, [WEBHOOK_SECRET]);
      expect(JSON.parse(log).props.webhook.has_secret).toBe(true);
    });

    it('keeps the secret out of the webhook JSON API', async () => {
      const webhook = await webhookWithSecret();

      const list = await bodyOf(await apiFetch(base, '/escalated/admin/webhooks', asAdmin));
      expectNoSecrets(list, [WEBHOOK_SECRET]);
      expect(JSON.parse(list)[0].has_secret).toBe(true);

      const show = await bodyOf(
        await apiFetch(base, `/escalated/admin/webhooks/${webhook.id}`, asAdmin),
      );
      expectNoSecrets(show, [WEBHOOK_SECRET]);
      expect(JSON.parse(show)).toMatchObject({ id: webhook.id, has_secret: true });

      const deliveries = await bodyOf(
        await apiFetch(base, `/escalated/admin/webhooks/${webhook.id}/deliveries`, asAdmin),
      );
      expectNoSecrets(deliveries, [WEBHOOK_SECRET]);

      const updated = await bodyOf(
        await apiFetch(base, `/escalated/admin/webhooks/${webhook.id}`, {
          ...asAdmin,
          method: 'PUT',
          body: { isActive: false },
        }),
      );
      expectNoSecrets(updated, [WEBHOOK_SECRET]);
      expect(JSON.parse(updated)).toMatchObject({ isActive: false, has_secret: true });
    });

    it('shows a secret the API generated once, in the create response only', async () => {
      const created = JSON.parse(
        await bodyOf(
          await apiFetch(base, '/escalated/admin/webhooks', {
            ...asAdmin,
            body: { name: 'Gen', url: 'https://1.1.1.1/gen', events: ['ticket.created'] },
          }),
        ),
      );
      const stored = await storedSecret(created.id);
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      expect(created).toMatchObject({ secret: stored, has_secret: true });

      expectNoSecrets(await bodyOf(await apiFetch(base, '/escalated/admin/webhooks', asAdmin)), [
        stored,
      ]);
    });

    it('keeps the stored secret when the form is saved with the secret left blank', async () => {
      const webhook = await webhookWithSecret();

      const res = await inertiaFetch(base, `/escalated/admin/webhooks/${webhook.id}`, {
        ...asAdmin,
        method: 'PUT',
        body: {
          url: 'https://1.1.1.1/escalated',
          events: ['ticket.created', 'ticket.updated'],
          secret: '',
          clear_secret: false,
          active: true,
        },
        headers: { referer: `${base}/escalated/admin/webhooks/${webhook.id}/edit` },
      });
      expect(res.status).toBe(303);

      const saved = await source.getRepository(Webhook).findOneByOrFail({ id: webhook.id });
      expect(saved.secret).toBe(WEBHOOK_SECRET);
      expect(saved.events).toEqual(['ticket.created', 'ticket.updated']);
    });

    it('replaces the secret when a new one is entered, and clears it on request', async () => {
      const webhook = await webhookWithSecret();
      const form = { url: 'https://1.1.1.1/escalated', events: ['ticket.created'], active: true };
      const save = (body: object) =>
        inertiaFetch(base, `/escalated/admin/webhooks/${webhook.id}`, {
          ...asAdmin,
          method: 'PUT',
          body: { ...form, ...body },
          headers: { referer: `${base}/escalated/admin/webhooks/${webhook.id}/edit` },
        });

      expect((await save({ secret: 'whsec-new' })).status).toBe(303);
      expect(await storedSecret(webhook.id)).toBe('whsec-new');

      expect((await save({ secret: '', clear_secret: true })).status).toBe(303);
      expect(await storedSecret(webhook.id)).toBe('');

      const edit = await page(base, `/escalated/admin/webhooks/${webhook.id}/edit`, asAdmin);
      expect(edit.props.webhook.has_secret).toBe(false);
    });

    it('applies the same secret rules to the JSON API update', async () => {
      const webhook = await webhookWithSecret();
      const put = (body: object) =>
        apiFetch(base, `/escalated/admin/webhooks/${webhook.id}`, {
          ...asAdmin,
          method: 'PUT',
          body,
        });

      expect((await put({ secret: '' })).status).toBe(200);
      expect(await storedSecret(webhook.id)).toBe(WEBHOOK_SECRET);

      expect((await put({ secret: 'whsec-api' })).status).toBe(200);
      expect(await storedSecret(webhook.id)).toBe('whsec-api');

      const cleared = await put({ clear_secret: true });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).has_secret).toBe(false);
      expect(await storedSecret(webhook.id)).toBe('');
    });
  });

  // --- API tokens ------------------------------------------------------------

  describe('API tokens', () => {
    it('shows a token once on creation and never lists the stored value', async () => {
      const created = JSON.parse(
        await bodyOf(
          await apiFetch(base, '/escalated/admin/api-tokens', { ...asAdmin, body: { name: 'CI' } }),
        ),
      );
      const plain = created.plainTextToken;
      expect(plain).toMatch(/^[0-9a-f]{80}$/);
      expect(created.token).not.toHaveProperty('token');

      const list = await bodyOf(await apiFetch(base, '/escalated/admin/api-tokens', asAdmin));
      expect(JSON.parse(list).some((t: any) => t.name === 'CI')).toBe(true);
      expectNoSecrets(list, [plain]);

      const index = await bodyOf(await inertiaFetch(base, '/escalated/admin/api-tokens', asAdmin));
      expectNoSecrets(index, [plain]);
    });
  });

  // --- Two-factor ------------------------------------------------------------

  describe('two-factor records', () => {
    it('keeps the 2FA secret and recovery codes out of the agent JSON API', async () => {
      const profile = await source.getRepository(AgentProfile).save(
        source.getRepository(AgentProfile).create({
          userId: 4242,
          displayName: 'Two Factor',
          twoFactorEnabled: true,
          twoFactorSecret: TOTP_SECRET,
          twoFactorRecoveryCodes: [RECOVERY_CODE],
        }),
      );

      const list = await bodyOf(await apiFetch(base, '/escalated/admin/agents', asAdmin));
      expect(JSON.parse(list).some((p: any) => p.id === profile.id)).toBe(true);
      expectNoSecrets(list, [TOTP_SECRET, RECOVERY_CODE]);

      const show = await bodyOf(
        await apiFetch(base, `/escalated/admin/agents/${profile.id}`, asAdmin),
      );
      expect(JSON.parse(show).profile).toMatchObject({ id: profile.id, twoFactorEnabled: true });
      expectNoSecrets(show, [TOTP_SECRET, RECOVERY_CODE]);
    });
  });

  // --- Entities never serialize their secrets -------------------------------

  it('hides secrets on every entity that stores one', () => {
    const webhook = source
      .getRepository(Webhook)
      .create({ name: 'n', url: 'https://1.1.1.1', events: [], secret: WEBHOOK_SECRET });
    const job = source.getRepository(ImportJob).create({ platform: 'x', credentials: 'sealed' });
    const token = source.getRepository(ApiToken).create({ name: 'CI', token: 'tok-123456' });
    const profile = source.getRepository(AgentProfile).create({
      twoFactorSecret: TOTP_SECRET,
      twoFactorRecoveryCodes: [RECOVERY_CODE],
    });

    const json = (value: unknown) => JSON.parse(JSON.stringify(value));
    expect(json(webhook)).not.toHaveProperty('secret');
    expect(json(webhook).has_secret).toBe(true);
    expect(json(job)).not.toHaveProperty('credentials');
    expect(json(token)).not.toHaveProperty('token');
    expect(json(profile)).not.toHaveProperty('twoFactorSecret');
    expect(json(profile)).not.toHaveProperty('twoFactorRecoveryCodes');
    // Still readable server-side.
    expect(webhook.secret).toBe(WEBHOOK_SECRET);
    expect(token.token).toBe('tok-123456');
    expect(profile.twoFactorSecret).toBe(TOTP_SECRET);
  });
});
