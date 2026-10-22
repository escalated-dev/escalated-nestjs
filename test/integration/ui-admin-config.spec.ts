import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BusinessSchedule,
  CannedResponse,
  Macro,
  Reply,
  SlaPolicy,
  Tag,
  Ticket,
  TicketStatus,
  Webhook,
  WebhookDelivery,
} from '../../src/entities';
import {
  ADMIN,
  AGENT,
  apiFetch,
  bootUi,
  cookieFrom,
  CUSTOMER,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The admin configuration screens over real HTTP and SQLite: SLA policies,
 * statuses, macros, canned responses and webhooks, with escalated-laravel's
 * admin controllers as the prop contract.
 */
describe('admin configuration screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;

  const asAdmin = { as: 'admin' as const };

  /** A form the Inertia client submits from `from`. */
  const submit = (path: string, body: unknown, method = 'POST', from = path) =>
    inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body,
      headers: { referer: `${base}${from}` },
    });

  /** The page a redirect lands on, with the flash data it carried. */
  const follow = (res: Response) =>
    page(base, res.headers.get('location')!, {
      ...asAdmin,
      headers: { cookie: cookieFrom(res) },
    });

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    open = await source
      .getRepository(TicketStatus)
      .save({ name: 'Open', slug: 'open', isDefault: true, sortOrder: 1 });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the configuration screens behind the admin guard', async () => {
    for (const path of [
      '/escalated/admin/sla-policies',
      '/escalated/admin/statuses',
      '/escalated/admin/macros',
      '/escalated/admin/canned-responses',
      '/escalated/admin/webhooks',
    ]) {
      expect((await inertiaFetch(base, path, { as: 'agent' })).status).toBe(403);
    }
  });

  describe('Escalated/Admin/SlaPolicies', () => {
    it('lists policies with targets in hours and ticket counts', async () => {
      const policy = await source.getRepository(SlaPolicy).save({
        name: 'Standard',
        firstResponseHigh: 90,
        resolutionUrgent: 120,
      });
      await source.getRepository(Ticket).save({
        referenceNumber: 'SLA-1',
        subject: 'Covered',
        description: 'x',
        priority: 'high',
        channel: 'web',
        statusId: open.id,
        requesterId: CUSTOMER,
        slaPolicyId: policy.id,
      });

      const result = await page(base, '/escalated/admin/sla-policies', asAdmin);
      expect(result.component).toBe('Escalated/Admin/SlaPolicies/Index');
      expectManifestProps(result);
      expect(result.props.policies).toContainEqual(
        expect.objectContaining({
          id: policy.id,
          name: 'Standard',
          is_active: true,
          is_default: false,
          business_hours_only: false,
          tickets_count: 1,
          first_response_hours: { low: 1, medium: 0.5, high: 1.5, urgent: 0.08 },
          resolution_hours: { low: 24, medium: 8, high: 4, urgent: 2 },
        }),
      );
    });

    it('creates a policy from the form, in minutes, as the only default', async () => {
      await source.getRepository(SlaPolicy).save({ name: 'Old default', isDefault: true });
      const form = await page(base, '/escalated/admin/sla-policies/create', asAdmin);
      expect(form.component).toBe('Escalated/Admin/SlaPolicies/Form');
      expectManifestProps(form);
      expect(form.props).toMatchObject({
        policy: null,
        priorities: ['low', 'medium', 'high', 'urgent'],
      });

      const res = await submit('/escalated/admin/sla-policies', {
        name: 'Premium',
        description: 'Fast',
        is_default: true,
        first_response_hours: { low: 2, urgent: 0.5 },
        resolution_hours: { high: 6 },
        business_hours_only: false,
        is_active: true,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/sla-policies');
      expect((await follow(res)).props.flash.success).toBe('SLA policy created.');

      const saved = await source.getRepository(SlaPolicy).findOneByOrFail({ name: 'Premium' });
      expect(saved).toMatchObject({
        description: 'Fast',
        isDefault: true,
        firstResponseLow: 120,
        firstResponseUrgent: 30,
        resolutionHigh: 360,
        businessScheduleId: null,
      });
      expect(
        (await source.getRepository(SlaPolicy).findOneByOrFail({ name: 'Old default' })).isDefault,
      ).toBe(false);
    });

    it('edits a policy, limits it to business hours, and deletes it', async () => {
      const policy = await source.getRepository(SlaPolicy).save({ name: 'Edit me' });
      const edit = await page(base, `/escalated/admin/sla-policies/${policy.id}/edit`, asAdmin);
      expect(edit.props.policy).toMatchObject({ id: policy.id, name: 'Edit me' });

      const refused = await submit(
        `/escalated/admin/sla-policies/${policy.id}`,
        { name: 'Edit me', business_hours_only: true },
        'PUT',
        `/escalated/admin/sla-policies/${policy.id}/edit`,
      );
      expect(Object.keys((await follow(refused)).props.errors)).toEqual(['business_hours_only']);

      const schedule = await source.getRepository(BusinessSchedule).save({
        name: 'Office',
        isDefault: true,
        schedule: {} as any,
      });
      const res = await submit(
        `/escalated/admin/sla-policies/${policy.id}`,
        { name: 'Renamed', business_hours_only: true, first_response_hours: { high: 3 } },
        'PUT',
      );
      expect(res.status).toBe(303);
      // Not pinned to the default: the ticket's department schedule comes first.
      expect(
        await source.getRepository(SlaPolicy).findOneByOrFail({ id: policy.id }),
      ).toMatchObject({
        name: 'Renamed',
        businessHoursOnly: true,
        businessScheduleId: null,
        firstResponseHigh: 180,
      });
      const edited = await page(base, `/escalated/admin/sla-policies/${policy.id}/edit`, asAdmin);
      expect(edited.props.policy).toMatchObject({
        business_hours_only: true,
        business_schedule_id: null,
      });

      await submit(
        `/escalated/admin/sla-policies/${policy.id}`,
        { name: 'Renamed', business_hours_only: true, business_schedule_id: schedule.id },
        'PUT',
      );
      expect(
        (await source.getRepository(SlaPolicy).findOneByOrFail({ id: policy.id }))
          .businessScheduleId,
      ).toBe(schedule.id);
      await submit(
        `/escalated/admin/sla-policies/${policy.id}`,
        { name: 'Renamed', business_hours_only: true },
        'PUT',
      );
      expect(
        (await source.getRepository(SlaPolicy).findOneByOrFail({ id: policy.id }))
          .businessScheduleId,
      ).toBe(schedule.id);

      const unknown = await submit(
        `/escalated/admin/sla-policies/${policy.id}`,
        { name: 'Renamed', business_hours_only: true, business_schedule_id: 999999 },
        'PUT',
        `/escalated/admin/sla-policies/${policy.id}/edit`,
      );
      expect(Object.keys((await follow(unknown)).props.errors)).toEqual(['business_schedule_id']);

      await submit(
        `/escalated/admin/sla-policies/${policy.id}`,
        { name: 'Renamed', business_hours_only: false },
        'PUT',
      );
      expect(
        await source.getRepository(SlaPolicy).findOneByOrFail({ id: policy.id }),
      ).toMatchObject({ businessHoursOnly: false, businessScheduleId: null });

      const gone = await submit(`/escalated/admin/sla-policies/${policy.id}`, undefined, 'DELETE');
      expect(gone.status).toBe(303);
      expect(await source.getRepository(SlaPolicy).countBy({ id: policy.id })).toBe(0);
    });

    it('sends a nameless policy back with an error', async () => {
      const res = await submit(
        '/escalated/admin/sla-policies',
        { name: '' },
        'POST',
        '/escalated/admin/sla-policies/create',
      );
      expect(res.headers.get('location')).toBe('/escalated/admin/sla-policies/create');
      expect(Object.keys((await follow(res)).props.errors)).toEqual(['name']);
    });
  });

  describe('Escalated/Admin/Statuses', () => {
    it('lists statuses with the categories this backend distinguishes', async () => {
      await source
        .getRepository(TicketStatus)
        .save({ name: 'Done', slug: 'done', isClosed: true, color: '#00ff00', sortOrder: 5 });
      const result = await page(base, '/escalated/admin/statuses', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Statuses/Index');
      expectManifestProps(result);
      expect(result.props.categories).toEqual(['open', 'solved']);
      expect(result.props.statuses).toContainEqual(
        expect.objectContaining({
          label: 'Open',
          slug: 'open',
          category: 'open',
          is_default: true,
        }),
      );
      expect(result.props.statuses).toContainEqual(
        expect.objectContaining({
          label: 'Done',
          category: 'solved',
          color: '#00ff00',
          position: 5,
        }),
      );
    });

    it('creates, edits and deletes a status, keeping its slug', async () => {
      const create = await page(base, '/escalated/admin/statuses/create', asAdmin);
      expect(create.component).toBe('Escalated/Admin/Statuses/Form');
      expectManifestProps(create);
      expect(create.props.status).toBeNull();

      const res = await submit('/escalated/admin/statuses', {
        label: 'Waiting on Customer',
        category: 'open',
        color: '#ffaa00',
        position: 3,
        is_default: false,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/statuses');
      const status = await source
        .getRepository(TicketStatus)
        .findOneByOrFail({ slug: 'waiting_on_customer' });
      expect(status).toMatchObject({ name: 'Waiting on Customer', isClosed: false, sortOrder: 3 });

      const edit = await page(base, `/escalated/admin/statuses/${status.id}/edit`, asAdmin);
      expect(edit.props.status).toMatchObject({ id: status.id, label: 'Waiting on Customer' });

      await submit(
        `/escalated/admin/statuses/${status.id}`,
        { label: 'Awaiting reply', category: 'solved', color: '#111111', is_default: true },
        'PUT',
      );
      const updated = await source.getRepository(TicketStatus).findOneByOrFail({ id: status.id });
      expect(updated).toMatchObject({
        name: 'Awaiting reply',
        slug: 'waiting_on_customer',
        isClosed: true,
        isDefault: true,
      });
      expect(
        (await source.getRepository(TicketStatus).findOneByOrFail({ id: open.id })).isDefault,
      ).toBe(false);

      await submit(`/escalated/admin/statuses/${status.id}`, undefined, 'DELETE');
      expect(await source.getRepository(TicketStatus).countBy({ id: status.id })).toBe(0);
    });

    it('refuses to delete a status tickets still have, and an unknown category', async () => {
      const res = await submit(
        `/escalated/admin/statuses/${open.id}`,
        undefined,
        'DELETE',
        '/escalated/admin/statuses',
      );
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.error).toMatch(/have this status/);
      expect(await source.getRepository(TicketStatus).countBy({ id: open.id })).toBe(1);

      const bad = await submit(
        '/escalated/admin/statuses',
        { label: 'X', category: 'on_hold', color: '#000000' },
        'POST',
        '/escalated/admin/statuses/create',
      );
      expect(Object.keys((await follow(bad)).props.errors)).toEqual(['category']);
    });
  });

  describe('Escalated/Admin/Macros/Index', () => {
    it('lists every macro with its creator, and saves the screen’s macros', async () => {
      await source.getRepository(Macro).save({
        name: 'Personal',
        actions: [{ type: 'priority', value: 'low' }],
        scope: 'personal',
        createdBy: AGENT,
      });
      const result = await page(base, '/escalated/admin/macros', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Macros/Index');
      expectManifestProps(result);
      expect(result.props.macros).toContainEqual(
        expect.objectContaining({
          name: 'Personal',
          is_shared: false,
          creator: { id: AGENT, name: `User #${AGENT}` },
          actions: [{ type: 'priority', value: 'low', order: 0 }],
        }),
      );

      const res = await submit('/escalated/admin/macros', {
        name: 'Resolve politely',
        description: 'Thank and resolve',
        is_shared: true,
        actions: [
          { type: 'reply', value: 'Thanks for writing in!', order: 0 },
          { type: 'status', value: 'open', order: 1 },
          { type: 'priority', value: 'urgent', order: 2 },
        ],
      });
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.success).toBe('Macro created.');
      const macro = await source.getRepository(Macro).findOneByOrFail({ name: 'Resolve politely' });
      expect(macro).toMatchObject({ scope: 'shared', createdBy: ADMIN });

      await submit(
        `/escalated/admin/macros/${macro.id}`,
        { name: 'Renamed', is_shared: false, actions: macro.actions },
        'PUT',
      );
      expect(await source.getRepository(Macro).findOneByOrFail({ id: macro.id })).toMatchObject({
        name: 'Renamed',
        scope: 'personal',
      });

      await submit(`/escalated/admin/macros/${macro.id}`, undefined, 'DELETE');
      expect(await source.getRepository(Macro).countBy({ id: macro.id })).toBe(0);
    });

    it('refuses an action type the screen does not offer', async () => {
      const res = await submit(
        '/escalated/admin/macros',
        { name: 'Bad', actions: [{ type: 'explode', value: 1 }] },
        'POST',
        '/escalated/admin/macros',
      );
      expect(Object.keys((await follow(res)).props.errors)).toEqual(['actions.0.type']);
    });

    it('runs the screen’s action names when an agent applies the macro', async () => {
      const vip = await source.getRepository(Tag).save({ name: 'VIP', slug: 'vip-macro' });
      const closed = await source
        .getRepository(TicketStatus)
        .save({ name: 'Closed', slug: 'closed', isClosed: true });
      const ticket = await source.getRepository(Ticket).save({
        referenceNumber: 'MAC-1',
        subject: 'Macro me',
        description: 'x',
        priority: 'low',
        channel: 'web',
        statusId: open.id,
        requesterId: CUSTOMER,
      });
      const macro = await source.getRepository(Macro).save({
        name: 'Everything',
        scope: 'shared',
        actions: [
          { type: 'status', value: 'closed' },
          { type: 'priority', value: 'high' },
          { type: 'tags', value: `${vip.id}` },
          { type: 'reply', value: 'Done!' },
          { type: 'note', value: 'Closed by macro' },
        ],
      });

      const res = await inertiaFetch(base, `/escalated/agent/tickets/MAC-1/macro`, {
        body: { macro_id: macro.id },
        headers: { referer: `${base}/escalated/agent/tickets/MAC-1` },
      });
      expect(res.status).toBe(303);
      const after = await source
        .getRepository(Ticket)
        .findOneOrFail({ where: { id: ticket.id }, relations: { tags: true } });
      expect(after).toMatchObject({ statusId: closed.id, priority: 'high' });
      expect(after.tags.map((t) => t.id)).toEqual([vip.id]);
      const replies = await source
        .getRepository(Reply)
        .find({ where: { ticketId: ticket.id }, order: { id: 'ASC' } });
      expect(replies.map((r) => [r.body, r.isInternal])).toEqual([
        ['Done!', false],
        ['Closed by macro', true],
      ]);
    });
  });

  describe('Escalated/Admin/CannedResponses/Index', () => {
    it('lists, creates, updates and deletes canned responses', async () => {
      await source.getRepository(CannedResponse).save({
        title: 'Hi',
        shortCode: 'hi',
        content: 'Hello!',
        scope: 'personal',
        createdBy: AGENT,
      });
      const result = await page(base, '/escalated/admin/canned-responses', asAdmin);
      expect(result.component).toBe('Escalated/Admin/CannedResponses/Index');
      expectManifestProps(result);
      expect(result.props.responses).toContainEqual(
        expect.objectContaining({
          title: 'Hi',
          body: 'Hello!',
          is_shared: false,
          category: null,
          creator: { id: AGENT, name: `User #${AGENT}` },
        }),
      );

      const res = await submit('/escalated/admin/canned-responses', {
        title: 'Refunds',
        body: 'Refunds take 5 days.',
        category: 'billing',
        is_shared: true,
      });
      expect(res.status).toBe(303);
      const saved = await source
        .getRepository(CannedResponse)
        .findOneByOrFail({ title: 'Refunds' });
      expect(saved).toMatchObject({
        content: 'Refunds take 5 days.',
        shortCode: 'refunds',
        scope: 'shared',
        createdBy: ADMIN,
      });

      await submit(
        `/escalated/admin/canned-responses/${saved.id}`,
        { title: 'Refunds', body: 'Refunds take 3 days.', is_shared: true },
        'PUT',
      );
      expect(
        await source.getRepository(CannedResponse).findOneByOrFail({ id: saved.id }),
      ).toMatchObject({ content: 'Refunds take 3 days.', shortCode: 'refunds' });

      await submit(`/escalated/admin/canned-responses/${saved.id}`, undefined, 'DELETE');
      expect(await source.getRepository(CannedResponse).countBy({ id: saved.id })).toBe(0);

      const bad = await submit(
        '/escalated/admin/canned-responses',
        { title: 'No body' },
        'POST',
        '/escalated/admin/canned-responses',
      );
      expect(Object.keys((await follow(bad)).props.errors)).toEqual(['body']);
    });
  });

  describe('Escalated/Admin/Webhooks', () => {
    const realFetch = global.fetch;
    let outbound: string[] = [];

    beforeAll(() => {
      jest.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
        const url = String(input?.url ?? input);
        if (url.startsWith(base)) return realFetch(input, init);
        outbound.push(url);
        return Promise.resolve(new Response('ok', { status: 200 }));
      });
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    it('creates a webhook from the form and lists it with its latest delivery', async () => {
      const form = await page(base, '/escalated/admin/webhooks/create', asAdmin);
      expect(form.component).toBe('Escalated/Admin/Webhooks/Form');
      expectManifestProps(form);
      expect(form.props.webhook).toBeNull();
      expect(form.props.availableEvents).toEqual(
        expect.arrayContaining(['ticket.created', 'reply.created', 'note.created', 'sla.breached']),
      );

      const res = await submit('/escalated/admin/webhooks', {
        url: 'https://1.1.1.1/hooks',
        events: ['ticket.created', 'reply.created'],
        secret: 'shh',
        active: true,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/webhooks');
      const webhook = await source
        .getRepository(Webhook)
        .findOneByOrFail({ url: 'https://1.1.1.1/hooks' });
      expect(webhook).toMatchObject({ name: '1.1.1.1', secret: 'shh', isActive: true });
      await source.getRepository(WebhookDelivery).save({
        webhookId: webhook.id,
        event: 'ticket.created',
        payload: JSON.stringify({ event: 'ticket.created' }),
        status: 'failed',
        responseStatus: 500,
        attempts: 1,
      });

      const index = await follow(res);
      expect(index.component).toBe('Escalated/Admin/Webhooks/Index');
      expectManifestProps(index);
      expect(index.props.flash.success).toBe('Webhook created.');
      expect(index.props.webhooks).toContainEqual(
        expect.objectContaining({
          id: webhook.id,
          url: 'https://1.1.1.1/hooks',
          events: ['ticket.created', 'reply.created'],
          active: true,
          deliveries_count: 1,
          deliveries: [expect.objectContaining({ event: 'ticket.created', response_code: 500 })],
        }),
      );
    });

    it('edits, refuses a private URL, shows the delivery log, retries and deletes', async () => {
      const webhook = await source.getRepository(Webhook).save({
        name: 'Ops',
        url: 'https://1.0.0.1/ops',
        secret: 's',
        events: ['ticket.created'],
      });
      const delivery = await source.getRepository(WebhookDelivery).save({
        webhookId: webhook.id,
        event: 'ticket.created',
        payload: JSON.stringify({ event: 'ticket.created', data: { id: 1 } }),
        status: 'failed',
        responseStatus: 502,
        attempts: 1,
      });

      const edit = await page(base, `/escalated/admin/webhooks/${webhook.id}/edit`, asAdmin);
      expect(edit.props.webhook).toMatchObject({ id: webhook.id, url: 'https://1.0.0.1/ops' });

      const privateUrl = await submit(
        `/escalated/admin/webhooks/${webhook.id}`,
        { url: 'http://127.0.0.1/admin', events: ['ticket.created'] },
        'PUT',
        `/escalated/admin/webhooks/${webhook.id}/edit`,
      );
      expect((await follow(privateUrl)).props.flash.error).toBeTruthy();

      await submit(
        `/escalated/admin/webhooks/${webhook.id}`,
        { url: 'https://1.0.0.1/ops2', events: ['ticket.closed'], active: false },
        'PUT',
      );
      expect(await source.getRepository(Webhook).findOneByOrFail({ id: webhook.id })).toMatchObject(
        {
          name: 'Ops',
          url: 'https://1.0.0.1/ops2',
          events: ['ticket.closed'],
          isActive: false,
        },
      );

      const log = await page(base, `/escalated/admin/webhooks/${webhook.id}/deliveries`, asAdmin);
      expect(log.component).toBe('Escalated/Admin/Webhooks/DeliveryLog');
      expectManifestProps(log);
      expect(log.props.webhook).toMatchObject({ id: webhook.id });
      expect(log.props.deliveries).toMatchObject({ total: 1, current_page: 1 });
      expect(log.props.deliveries.data[0]).toMatchObject({
        id: delivery.id,
        event: 'ticket.created',
        response_code: 502,
        attempts: 1,
        payload: { event: 'ticket.created', data: { id: 1 } },
      });

      outbound = [];
      const retried = await submit(
        `/escalated/admin/webhooks/deliveries/${delivery.id}/retry`,
        {},
        'POST',
        `/escalated/admin/webhooks/${webhook.id}/deliveries`,
      );
      expect(retried.status).toBe(303);
      expect(retried.headers.get('location')).toBe(
        `/escalated/admin/webhooks/${webhook.id}/deliveries`,
      );
      expect(outbound).toEqual(['https://1.0.0.1/ops2']);
      expect(
        await source.getRepository(WebhookDelivery).findOneByOrFail({ id: delivery.id }),
      ).toMatchObject({ status: 'success', responseStatus: 200, attempts: 2 });

      await submit(`/escalated/admin/webhooks/${webhook.id}`, undefined, 'DELETE');
      expect(await source.getRepository(Webhook).countBy({ id: webhook.id })).toBe(0);
    });

    it('keeps the JSON API for API clients', async () => {
      const res = await apiFetch(base, '/escalated/admin/webhooks', asAdmin);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    });
  });

  it('names every route the configuration screens call', async () => {
    const result = await page(base, '/escalated/admin/statuses', asAdmin);
    const routes = Object.keys(result.props.ziggy.routes);
    for (const resource of ['sla-policies', 'statuses', 'webhooks']) {
      for (const action of ['index', 'create', 'store', 'edit', 'update', 'destroy']) {
        expect(routes).toContain(`escalated.admin.${resource}.${action}`);
      }
    }
    for (const resource of ['macros', 'canned-responses']) {
      for (const action of ['index', 'store', 'update', 'destroy']) {
        expect(routes).toContain(`escalated.admin.${resource}.${action}`);
      }
    }
    expect(routes).toContain('escalated.admin.webhooks.deliveries');
    expect(routes).toContain('escalated.admin.webhooks.retry');
  });
});
