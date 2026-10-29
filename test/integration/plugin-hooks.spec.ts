import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Department, Tag, Ticket, TicketStatus } from '../../src/entities';
import type { EscalatedPluginDefinition, PluginContext } from '../../src/plugins/plugin-definition';
import { PluginRegistry } from '../../src/plugins/plugin-registry.service';
import { EscalatedSchedulerService } from '../../src/scheduling/escalated-scheduler.service';
import { CANONICAL_EVENTS, LEGACY_EVENT_NAMES } from '../../src/events/event-names';
import { apiFetch, bootUi, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/** Waits for `check` to hold: plugin actions run after the response. */
async function eventually(check: () => void, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/**
 * Plugin hooks and the plugin context over real HTTP and SQLite, as
 * domain-model/plugin-contract.md specifies: the canonical events reach active
 * plugins' actions with the payload the official plugins read, `ctx` reaches
 * the host's tickets, replies, contacts, tags, departments and agents, and
 * active plugins' menus, slots and widgets are shared as `escalated.plugins`.
 */
describe('plugin hooks and context', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let registry: PluginRegistry;
  let resolved: TicketStatus;

  const received: Array<{ plugin: string; hook: string; event: any }> = [];
  const cronRuns: Array<{ schedule: string; user: unknown }> = [];
  let ctxOf: PluginContext;

  const recorder = (plugin: string) =>
    Object.fromEntries(
      [...CANONICAL_EVENTS, ...Object.keys(LEGACY_EVENT_NAMES), 'crm.synced'].map((hook) => [
        hook,
        async (event: unknown) => {
          received.push({ plugin, hook, event });
        },
      ]),
    );

  const crm: EscalatedPluginDefinition = {
    name: '@acme/crm',
    version: '1.0.0',
    actions: {
      ...recorder('crm'),
      'ticket.updated': async () => {
        throw new Error('the CRM is down');
      },
    },
    filters: {
      'ticket.subject': { priority: 20, handler: (value: string) => `${value} [crm]` },
    },
    pages: [
      {
        route: 'settings',
        component: 'CrmSettings',
        menu: { label: 'CRM', section: 'admin', position: 40, icon: 'M0 0' },
      },
      {
        route: 'secret',
        component: 'CrmSecret',
        capability: 'manage_crm',
        menu: { label: 'Secret', section: 'admin' },
      },
    ],
    components: [
      {
        page: 'ticket.show',
        slot: 'sidebar',
        component: 'CrmCard',
        props: { compact: true },
        order: 5,
      },
    ],
    widgets: [
      { component: 'CrmWidget', label: 'Pipeline', size: 'full', order: 3 },
      {
        component: 'CrmInbox',
        label: 'Inbox',
        order: 4,
        // Asked as the viewer.
        badge: async (ctx) => `for ${(await ctx.currentUser())?.id}`,
      },
      {
        component: 'CrmBroken',
        label: 'Broken',
        order: 5,
        badge: async () => {
          throw new Error('badge failed');
        },
      },
    ],
    cron: {
      '* * * * *': async (ctx) => {
        cronRuns.push({ schedule: 'every minute', user: await ctx.currentUser() });
      },
      '0 9 * * *': async () => {
        cronRuns.push({ schedule: 'nine', user: null });
      },
      'not a schedule': async () => {
        cronRuns.push({ schedule: 'broken', user: null });
      },
    },
    onActivate: async (ctx) => {
      ctxOf = ctx;
    },
  };

  const quiet: EscalatedPluginDefinition = {
    name: 'quiet',
    version: '1.0.0',
    actions: recorder('quiet'),
    cron: {
      '* * * * *': async () => {
        cronRuns.push({ schedule: 'quiet', user: null });
      },
    },
    filters: {
      // A broken filter is skipped; the value carries on.
      'ticket.subject': () => {
        throw new Error('nope');
      },
      'ticket.priority': { priority: 1, handler: () => 'urgent' },
    },
    pages: [
      { route: 'inbox', component: 'QuietInbox', menu: { label: 'Quiet', section: 'admin' } },
    ],
  };

  const activate = (slug: string) =>
    inertiaFetch(base, `/escalated/admin/plugins/${slug}/activate`, {
      as: 'admin',
      method: 'POST',
      body: {},
    });

  const of = (plugin: string, hook: string) =>
    received.filter((entry) => entry.plugin === plugin && entry.hook === hook);

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({ plugins: [crm, quiet] }));
    registry = app.get(PluginRegistry);
    await source
      .getRepository(TicketStatus)
      .save({ name: 'Open', slug: 'open', isDefault: true, sortOrder: 1 });
    resolved = await source
      .getRepository(TicketStatus)
      .save({ name: 'Resolved', slug: 'resolved', sortOrder: 2 });
    await activate('acme--crm');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    received.length = 0;
  });

  describe('canonical events', () => {
    let ticketId: number;

    it('delivers ticket.created with the ticket flat and as `ticket`, and only to active plugins', async () => {
      const res = await apiFetch(base, '/escalated/customer/tickets', {
        as: 'customer',
        body: { subject: 'Printer on fire', description: 'Smoke everywhere', priority: 'high' },
      });
      expect(res.status).toBe(201);
      ticketId = (await res.json()).id;

      await eventually(() => expect(of('crm', 'ticket.created')).toHaveLength(1));
      const { event } = of('crm', 'ticket.created')[0];
      expect(event).toMatchObject({
        id: ticketId,
        reference: expect.any(String),
        subject: 'Printer on fire',
        title: 'Printer on fire',
        description: 'Smoke everywhere',
        status: 'open',
        priority: 'high',
        requester_id: 300,
        assigned_to: null,
        created_at: expect.any(String),
      });
      expect(event.ticket).toEqual(
        Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'ticket')),
      );
      expect(of('quiet', 'ticket.created')).toEqual([]);
    });

    it('delivers reply.created with the reply flat, `reply` and `ticket`, and never a legacy name', async () => {
      const res = await apiFetch(base, `/escalated/customer/tickets/${ticketId}/replies`, {
        as: 'customer',
        body: { body: 'Still burning' },
      });
      expect(res.status).toBe(201);

      await eventually(() => expect(of('crm', 'reply.created')).toHaveLength(1));
      const { event } = of('crm', 'reply.created')[0];
      expect(event).toMatchObject({
        body: 'Still burning',
        ticket_id: ticketId,
        is_internal: false,
        reply: { body: 'Still burning', ticket_id: ticketId },
        ticket: { id: ticketId, subject: 'Printer on fire' },
      });
      expect(received.map((entry) => entry.hook)).not.toEqual(
        expect.arrayContaining(Object.keys(LEGACY_EVENT_NAMES)),
      );
    });

    it('delivers ticket.status_changed with old and new status, and a throwing action fails nothing', async () => {
      const res = await apiFetch(base, `/escalated/agent/tickets/${ticketId}`, {
        as: 'admin',
        method: 'PUT',
        body: { statusId: resolved.id },
      });
      expect(res.status).toBe(200);

      await eventually(() => expect(of('crm', 'ticket.status_changed')).toHaveLength(1));
      expect(of('crm', 'ticket.status_changed')[0].event).toMatchObject({
        id: ticketId,
        status: 'resolved',
        old_status: 'open',
        new_status: 'resolved',
        ticket: { id: ticketId, status: 'resolved' },
      });
      await eventually(() => expect(of('crm', 'ticket.resolved')).toHaveLength(1));
      expect(of('crm', 'ticket.resolved')[0].event).toMatchObject({ id: ticketId });
    });
  });

  describe('filters', () => {
    it('runs active plugins in priority order, skipping a failing one', async () => {
      expect(await registry.applyFilters('ticket.subject', 'Help')).toBe('Help [crm]');
      // `quiet` is inactive, so its priority-1 filter does not run.
      expect(await registry.applyFilters('ticket.priority', 'low')).toBe('low');

      await activate('quiet');
      expect(await registry.applyFilters('ticket.subject', 'Help')).toBe('Help [crm]');
      expect(await registry.applyFilters('ticket.priority', 'low')).toBe('urgent');
    });
  });

  describe('ctx', () => {
    it('emits custom hooks to active plugins, and drops host-owned names', async () => {
      await ctxOf.emit('crm.synced', { count: 2 });
      expect(of('crm', 'crm.synced').map((entry) => entry.event)).toEqual([{ count: 2 }]);
      expect(of('quiet', 'crm.synced')).toHaveLength(1);

      received.length = 0;
      await ctxOf.emit('ticket.created', { id: 999 });
      await ctxOf.emit('plugin.activated', { slug: 'x' });
      expect(received).toEqual([]);
    });

    it('creates, finds, queries and updates tickets through the ticket service', async () => {
      const department = await source
        .getRepository(Department)
        .save({ name: 'Billing', slug: 'billing' });
      const created = await ctxOf.tickets.create({
        title: 'From the CRM',
        body: 'Invoice question',
        priority: 'low',
        department_id: department.id,
        metadata: { source: 'crm' },
        requester_id: 12345,
      });
      expect(created).toMatchObject({
        subject: 'From the CRM',
        description: 'Invoice question',
        priority: 'low',
        department_id: department.id,
        metadata: { source: 'crm' },
        channel: 'api',
        status: 'open',
      });
      // A plugin cannot pick the requester.
      expect(created.requester_id).not.toBe(12345);
      await eventually(() =>
        expect(of('crm', 'ticket.created').map((entry) => entry.event.id)).toEqual([created.id]),
      );

      expect(await ctxOf.tickets.find(created.id)).toMatchObject({ id: created.id });
      expect(await ctxOf.tickets.find(987654)).toBeNull();
      expect(
        (await ctxOf.tickets.query({ department_id: department.id })).map((t: any) => t.id),
      ).toEqual([created.id]);
      await expect(ctxOf.tickets.query({ 'subject; drop table': 'x' })).rejects.toThrow(
        'cannot filter tickets by',
      );

      const updated = await ctxOf.tickets.update(created.id, {
        status: 'resolved',
        priority: 'urgent',
        requester_id: 1,
      });
      expect(updated).toMatchObject({ id: created.id, status: 'resolved', priority: 'urgent' });
      expect(updated.requester_id).toBe(created.requester_id);
      expect(
        (await source.getRepository(Ticket).findOneByOrFail({ id: created.id })).statusId,
      ).toBe(resolved.id);
    });

    it('creates and reads replies, contacts, tags, departments and agents', async () => {
      const [ticket] = await ctxOf.tickets.query({ priority: 'urgent' });
      const reply = await ctxOf.replies.create({ ticket_id: ticket.id, body: 'Synced from CRM' });
      expect(reply).toMatchObject({
        ticket_id: ticket.id,
        body: 'Synced from CRM',
        is_internal: false,
      });
      expect(await ctxOf.replies.find(reply.id)).toMatchObject({ id: reply.id });
      expect((await ctxOf.replies.query({ ticket_id: ticket.id })).map((r: any) => r.id)).toContain(
        reply.id,
      );
      await expect(ctxOf.replies.create({ body: 'orphan' })).rejects.toThrow('ticket_id');

      const contact = await ctxOf.contacts.create({ name: 'Ada', email: 'ADA@example.com' });
      expect(contact).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
      expect(await ctxOf.contacts.findByEmail('ada@example.com')).toMatchObject({ id: contact.id });
      expect(await ctxOf.contacts.find(contact.id)).toMatchObject({ email: 'ada@example.com' });

      const tag = await ctxOf.tags.create({ name: 'CRM Lead' });
      expect(tag).toMatchObject({ name: 'CRM Lead', slug: 'crm-lead' });
      expect((await ctxOf.tags.all()).map((t: any) => t.name)).toContain('CRM Lead');
      expect(await source.getRepository(Tag).count({ where: { slug: 'crm-lead' } })).toBe(1);

      const departments = await ctxOf.departments.all();
      expect(departments.map((d: any) => d.slug)).toContain('billing');
      expect(await ctxOf.departments.find(departments[0].id)).toMatchObject({
        id: departments[0].id,
      });
      expect(await ctxOf.departments.find(999999)).toBeNull();

      expect(Array.isArray(await ctxOf.agents.all())).toBe(true);
      expect(await ctxOf.agents.find(999999)).toBeNull();
    });
  });

  describe('cron', () => {
    beforeEach(() => {
      cronRuns.length = 0;
    });

    it('runs the schedules of active plugins that are due this minute, as no user', async () => {
      await app.get(EscalatedSchedulerService).runPluginCron(new Date('2026-10-29T09:00:20Z'));
      expect(cronRuns).toEqual(
        expect.arrayContaining([
          { schedule: 'every minute', user: null },
          { schedule: 'nine', user: null },
        ]),
      );
      // `quiet` is active by now; its every-minute schedule runs too.
      expect(cronRuns).toContainEqual({ schedule: 'quiet', user: null });
      expect(cronRuns).toHaveLength(3);
    });

    it('skips schedules that are not due, and inactive plugins', async () => {
      await inertiaFetch(base, '/escalated/admin/plugins/quiet/deactivate', {
        as: 'admin',
        method: 'POST',
        body: {},
      });
      await registry.runDueCron(new Date('2026-10-29T09:01:00Z'));
      // `quiet` is inactive: its every-minute schedule does not run.
      expect(cronRuns).toEqual([{ schedule: 'every minute', user: null }]);
      await activate('quiet');
    });
  });

  describe('escalated.plugins', () => {
    it('shares active plugins’ menu items, page components and widgets', async () => {
      const shown = await page(base, '/escalated/admin/plugins', { as: 'admin' });
      const plugins = shown.props.escalated.plugins;

      expect(plugins.menuItems).toEqual([
        {
          label: 'CRM',
          route: '/escalated/admin/plugins/acme--crm/settings',
          icon: 'M0 0',
          position: 40,
          section: 'admin',
          plugin: 'acme--crm',
        },
        expect.objectContaining({ label: 'Quiet', position: 100 }),
      ]);
      // The admin has no role with `manage_crm`, so that page's menu item is left out.
      expect(plugins.pageComponents).toEqual({
        'ticket.show.sidebar': [
          { plugin: 'acme--crm', component: 'CrmCard', data: { compact: true }, position: 5 },
        ],
      });
      expect(plugins.dashboardWidgets).toEqual([
        {
          id: 'acme--crm.CrmWidget',
          title: 'Pipeline',
          component: 'CrmWidget',
          plugin: 'acme--crm',
          position: 3,
          width: 'full',
        },
        {
          id: 'acme--crm.CrmInbox',
          title: 'Inbox',
          component: 'CrmInbox',
          plugin: 'acme--crm',
          position: 4,
          width: 'half',
          badge: 'for 1',
        },
        {
          id: 'acme--crm.CrmBroken',
          title: 'Broken',
          component: 'CrmBroken',
          plugin: 'acme--crm',
          position: 5,
          width: 'half',
          badge: null,
        },
      ]);
    });

    it('leaves admin menu items out for agents, and shares nothing when no plugin is active', async () => {
      const agent = await page(base, '/escalated/agent', { as: 'agent' });
      expect(agent.props.escalated.plugins.menuItems).toEqual([]);

      for (const slug of ['acme--crm', 'quiet']) {
        await inertiaFetch(base, `/escalated/admin/plugins/${slug}/deactivate`, {
          as: 'admin',
          method: 'POST',
          body: {},
        });
      }
      const shown = await page(base, '/escalated/admin/plugins', { as: 'admin' });
      expect(shown.props.escalated.plugins).toEqual({});
    });
  });
});
