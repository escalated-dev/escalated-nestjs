import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AgentCapacity,
  AgentProfile,
  AgentSkill,
  AuditLog,
  Automation,
  BusinessSchedule,
  Department,
  Holiday,
  Skill,
  SlaPolicy,
  Tag,
} from '../../src/entities';
import {
  ADMIN,
  AGENT,
  apiFetch,
  bootUi,
  cookieFrom,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The admin operations screens over real HTTP and SQLite: automations,
 * business hours, skills, agent capacity and the audit log, with
 * escalated-laravel's AutomationController, BusinessHoursController,
 * SkillController, CapacityController and AuditLogController as the contract.
 */
describe('admin operations screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let profile: AgentProfile;

  const asAdmin = { as: 'admin' as const };

  const submit = (path: string, body: unknown, method = 'POST', from = path) =>
    inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body,
      headers: { referer: `${base}${from}` },
    });

  const follow = (res: Response) =>
    page(base, res.headers.get('location')!, {
      ...asAdmin,
      headers: { cookie: cookieFrom(res) },
    });

  const errorsAfter = async (res: Response) => {
    expect(res.status).toBe(303);
    return (await follow(res)).props.errors;
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ui: {
        enabled: true,
        resolveUsers: (ids) =>
          ids.map((id) => ({ id, name: `Host user ${id}`, email: `u${id}@example.com` })),
      },
    }));
    profile = await source
      .getRepository(AgentProfile)
      .save({ userId: AGENT, displayName: 'Agent Smith', isActive: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps every screen behind the admin guard', async () => {
    for (const path of [
      '/escalated/admin/automations',
      '/escalated/admin/automations/create',
      '/escalated/admin/business-hours',
      '/escalated/admin/business-hours/create',
      '/escalated/admin/skills',
      '/escalated/admin/skills/create',
      '/escalated/admin/capacity',
      '/escalated/admin/audit-log',
    ]) {
      expect((await inertiaFetch(base, path, { as: 'agent' })).status).toBe(403);
    }
  });

  describe('automations', () => {
    it('lists automations in position order, as the Laravel model serializes them', async () => {
      const repo = source.getRepository(Automation);
      const second = await repo.save({
        name: 'Close stale',
        conditions: [{ field: 'hours_since_updated', operator: '>', value: 72 }],
        actions: [{ type: 'change_status', value: 'closed' }],
        active: false,
        position: 2,
      });
      const first = await repo.save({
        name: 'Nudge',
        conditions: [{ field: 'status', operator: '=', value: 'open' }],
        actions: [{ type: 'add_note', value: 'Ping' }],
        position: 1,
      });

      const result = await page(base, '/escalated/admin/automations', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Automations/Index');
      expectManifestProps(result);
      const ids = result.props.automations.map((a: any) => a.id);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
      expect(result.props.automations).toContainEqual({
        id: second.id,
        name: 'Close stale',
        description: null,
        conditions: [{ field: 'hours_since_updated', operator: '>', value: 72 }],
        actions: [{ type: 'change_status', value: 'closed' }],
        active: false,
        position: 2,
        last_run_at: null,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
    });

    it('creates, edits, toggles and deletes an automation through the screens', async () => {
      const form = await page(base, '/escalated/admin/automations/create', asAdmin);
      expect(form.component).toBe('Escalated/Admin/Automations/Form');
      expectManifestProps(form);
      expect(form.props.automation).toBeNull();

      const created = await submit('/escalated/admin/automations', {
        name: 'Escalate idle',
        conditions: [{ field: 'hours_since_created', operator: '>=', value: 48 }],
        actions: [{ type: 'change_priority', value: 'high' }],
        active: true,
      });
      expect(created.status).toBe(303);
      expect(created.headers.get('location')).toBe('/escalated/admin/automations');
      const index = await follow(created);
      expect(index.props.flash.success).toBe('Automation created.');
      const row = await source.getRepository(Automation).findOneByOrFail({ name: 'Escalate idle' });
      expect(row.conditions).toEqual([{ field: 'hours_since_created', operator: '>=', value: 48 }]);
      expect(row.position).toBeGreaterThan(2);

      const edit = await page(base, `/escalated/admin/automations/${row.id}/edit`, asAdmin);
      expect(edit.component).toBe('Escalated/Admin/Automations/Form');
      expect(edit.props.automation).toMatchObject({ id: row.id, name: 'Escalate idle' });

      // The Index page's pause toggle sends the whole automation back.
      const toggled = await submit(
        `/escalated/admin/automations/${row.id}`,
        { name: 'Escalate idle', conditions: row.conditions, actions: row.actions, active: false },
        'PUT',
      );
      expect(toggled.status).toBe(303);
      expect((await follow(toggled)).props.flash.success).toBe('Automation updated.');
      expect((await source.getRepository(Automation).findOneByOrFail({ id: row.id })).active).toBe(
        false,
      );

      const deleted = await submit(`/escalated/admin/automations/${row.id}`, undefined, 'DELETE');
      expect(deleted.status).toBe(303);
      expect((await follow(deleted)).props.flash.success).toBe('Automation deleted.');
      expect(await source.getRepository(Automation).existsBy({ id: row.id })).toBe(false);
    });

    it('answers an incomplete automation with field errors', async () => {
      const errors = await errorsAfter(
        await submit(
          '/escalated/admin/automations',
          { name: '', conditions: [], actions: [] },
          'POST',
          '/escalated/admin/automations/create',
        ),
      );
      expect(Object.keys(errors).sort()).toEqual(['actions', 'conditions', 'name']);
    });

    it('keeps the JSON API for API clients', async () => {
      const res = await apiFetch(base, '/escalated/admin/automations', asAdmin);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toHaveProperty('conditions');
      expect((await apiFetch(base, '/escalated/admin/automations/create', asAdmin)).status).toBe(
        404,
      );
    });
  });

  describe('business hours', () => {
    it('lists schedules with their holidays', async () => {
      const schedule = await source.getRepository(BusinessSchedule).save({
        name: 'Office',
        timezone: 'America/Toronto',
        isDefault: true,
        schedule: { monday: { start: '09:00', end: '17:00' } },
      });
      await source.getRepository(Holiday).save({
        businessScheduleId: schedule.id,
        name: 'Canada Day',
        date: '2026-07-01',
        isRecurring: true,
      });

      const result = await page(base, '/escalated/admin/business-hours', asAdmin);
      expect(result.component).toBe('Escalated/Admin/BusinessHours/Index');
      expectManifestProps(result);
      expect(result.props.schedules).toContainEqual({
        id: schedule.id,
        name: 'Office',
        timezone: 'America/Toronto',
        is_default: true,
        schedule: { monday: { start: '09:00', end: '17:00' } },
        holidays: [
          {
            id: expect.any(Number),
            business_schedule_id: schedule.id,
            name: 'Canada Day',
            date: '2026-07-01',
            recurring: true,
            created_at: expect.any(String),
          },
        ],
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
    });

    it('creates and edits a schedule with holidays, keeping one default', async () => {
      const form = await page(base, '/escalated/admin/business-hours/create', asAdmin);
      expect(form.component).toBe('Escalated/Admin/BusinessHours/Form');
      expectManifestProps(form);
      expect(form.props.schedule).toBeNull();
      expect(form.props.timezones).toEqual(expect.arrayContaining(['UTC', 'Europe/London']));

      const week = {
        monday: { start: '08:00', end: '16:00' },
        tuesday: { start: '08:00', end: '16:00' },
        saturday: { start: '', end: '' },
      };
      const created = await submit('/escalated/admin/business-hours', {
        name: 'Support desk',
        timezone: 'Europe/London',
        is_default: true,
        schedule: week,
        holidays: [{ name: 'Boxing Day', date: '2026-12-26', recurring: true }],
      });
      expect(created.status).toBe(303);
      expect(created.headers.get('location')).toBe('/escalated/admin/business-hours');
      expect((await follow(created)).props.flash.success).toBe('Business schedule created.');

      const schedules = source.getRepository(BusinessSchedule);
      const row = await schedules.findOneOrFail({
        where: { name: 'Support desk' },
        relations: { holidays: true },
      });
      expect(row.isDefault).toBe(true);
      expect(row.schedule).toEqual(week);
      expect(row.holidays.map((h) => [h.name, h.date, h.isRecurring])).toEqual([
        ['Boxing Day', '2026-12-26', true],
      ]);
      expect(await schedules.countBy({ isDefault: true })).toBe(1);

      const edit = await page(base, `/escalated/admin/business-hours/${row.id}/edit`, asAdmin);
      expect(edit.component).toBe('Escalated/Admin/BusinessHours/Form');
      expectManifestProps(edit);
      expect(edit.props.schedule).toMatchObject({ id: row.id, name: 'Support desk' });

      const updated = await submit(
        `/escalated/admin/business-hours/${row.id}`,
        {
          name: 'Support desk (UK)',
          timezone: 'Europe/London',
          is_default: true,
          schedule: week,
          holidays: [{ name: 'New Year', date: '2027-01-01', recurring: false }],
        },
        'PUT',
      );
      expect(updated.status).toBe(303);
      expect((await follow(updated)).props.flash.success).toBe('Business schedule updated.');
      const after = await schedules.findOneOrFail({
        where: { id: row.id },
        relations: { holidays: true },
      });
      expect(after.name).toBe('Support desk (UK)');
      expect(after.holidays.map((h) => h.name)).toEqual(['New Year']);
    });

    it('refuses an unknown timezone and a holiday without a date', async () => {
      const errors = await errorsAfter(
        await submit(
          '/escalated/admin/business-hours',
          {
            name: 'Bad',
            timezone: 'Mars/Olympus',
            schedule: {},
            holidays: [{ name: 'X', date: '' }],
          },
          'POST',
          '/escalated/admin/business-hours/create',
        ),
      );
      expect(Object.keys(errors).sort()).toEqual(['holidays.0.date', 'timezone']);
    });

    it('deletes a schedule and clears it from the policies that used it', async () => {
      const schedule = await source
        .getRepository(BusinessSchedule)
        .save({ name: 'Temp', timezone: 'UTC', schedule: {} });
      const policy = await source
        .getRepository(SlaPolicy)
        .save({ name: 'Bronze', businessScheduleId: schedule.id } as Partial<SlaPolicy>);

      const res = await submit(
        `/escalated/admin/business-hours/${schedule.id}`,
        undefined,
        'DELETE',
      );
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.success).toBe('Business schedule deleted.');
      expect(await source.getRepository(BusinessSchedule).existsBy({ id: schedule.id })).toBe(
        false,
      );
      expect(
        (await source.getRepository(SlaPolicy).findOneByOrFail({ id: policy.id }))
          .businessScheduleId,
      ).toBeNull();
    });
  });

  describe('skills', () => {
    let billing: Tag;
    let sales: Department;

    beforeAll(async () => {
      billing = await source
        .getRepository(Tag)
        .save({ name: 'billing', slug: 'billing', color: '#ff0000' });
      sales = await source
        .getRepository(Department)
        .save({ name: 'Sales', slug: 'sales', isActive: true } as Partial<Department>);
    });

    it('creates a skill with routing and agents, lists and edits it', async () => {
      const form = await page(base, '/escalated/admin/skills/create', asAdmin);
      expect(form.component).toBe('Escalated/Admin/Skills/Form');
      expectManifestProps(form);
      expect(form.props.skill).toBeNull();
      expect(form.props.availableAgents).toEqual([
        { id: AGENT, name: 'Agent Smith', email: `u${AGENT}@example.com` },
      ]);
      expect(form.props.availableTags).toContainEqual({
        id: billing.id,
        name: 'billing',
        color: '#ff0000',
      });
      expect(form.props.availableDepartments).toContainEqual({ id: sales.id, name: 'Sales' });

      const created = await submit('/escalated/admin/skills', {
        name: 'Billing disputes',
        routing_tag_ids: [billing.id],
        routing_department_ids: [sales.id],
        agents: [{ user_id: AGENT, proficiency: 4 }],
      });
      expect(created.status).toBe(303);
      expect(created.headers.get('location')).toBe('/escalated/admin/skills');
      const index = await follow(created);
      expect(index.component).toBe('Escalated/Admin/Skills/Index');
      expectManifestProps(index);
      expect(index.props.flash.success).toBe('Skill created.');
      const skill = await source.getRepository(Skill).findOneByOrFail({ name: 'Billing disputes' });
      expect(index.props.skills).toContainEqual({
        id: skill.id,
        name: 'Billing disputes',
        slug: 'billing-disputes',
        agents_count: 1,
        routing_tags_count: 1,
        routing_departments_count: 1,
        updated_at: expect.any(String),
      });

      const edit = await page(base, `/escalated/admin/skills/${skill.id}/edit`, asAdmin);
      expect(edit.component).toBe('Escalated/Admin/Skills/Form');
      expectManifestProps(edit);
      expect(edit.props.skill).toEqual({
        id: skill.id,
        name: 'Billing disputes',
        slug: 'billing-disputes',
        routing_tag_ids: [billing.id],
        routing_department_ids: [sales.id],
        agents: [{ user_id: AGENT, proficiency: 4 }],
      });

      const updated = await submit(
        `/escalated/admin/skills/${skill.id}`,
        { name: 'Billing', routing_tag_ids: [], routing_department_ids: [sales.id], agents: [] },
        'PUT',
      );
      expect(updated.status).toBe(303);
      expect((await follow(updated)).props.flash.success).toBe('Skill updated.');
      expect(await source.getRepository(AgentSkill).countBy({ skillId: skill.id })).toBe(0);
      expect((await source.getRepository(Skill).findOneByOrFail({ id: skill.id })).name).toBe(
        'Billing',
      );

      const deleted = await submit(`/escalated/admin/skills/${skill.id}`, undefined, 'DELETE');
      expect(deleted.status).toBe(303);
      expect((await follow(deleted)).props.flash.success).toBe('Skill deleted.');
      expect(await source.getRepository(Skill).existsBy({ id: skill.id })).toBe(false);
    });

    it('refuses a duplicate name, a non-agent and a proficiency out of range', async () => {
      await source.getRepository(Skill).save({ name: 'Taken', slug: 'taken' });
      const errors = await errorsAfter(
        await submit(
          '/escalated/admin/skills',
          {
            name: 'Taken',
            routing_tag_ids: [999],
            agents: [
              { user_id: 4242, proficiency: 3 },
              { user_id: AGENT, proficiency: 9 },
            ],
          },
          'POST',
          '/escalated/admin/skills/create',
        ),
      );
      expect(Object.keys(errors).sort()).toEqual([
        'agents.0.user_id',
        'agents.1.proficiency',
        'name',
        'routing_tag_ids.0',
      ]);
    });

    it('keeps the JSON API for API clients', async () => {
      const res = await apiFetch(base, '/escalated/admin/skills', asAdmin);
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveProperty('skills');
    });
  });

  describe('capacity', () => {
    it('lists capacity per agent and updates the limit', async () => {
      const capacity = await source
        .getRepository(AgentCapacity)
        .save({ agentProfileId: profile.id, maxTickets: 8, currentTickets: 2 });

      const result = await page(base, '/escalated/admin/capacity', asAdmin);
      expect(result.component).toBe('Escalated/Admin/Capacity/Index');
      expectManifestProps(result);
      expect(result.props.capacities).toEqual([
        {
          id: capacity.id,
          user_id: AGENT,
          agent_name: 'Agent Smith',
          channel: 'default',
          max_concurrent: 8,
          current_count: 2,
          load_percentage: 25,
        },
      ]);

      const res = await submit(
        `/escalated/admin/capacity/${capacity.id}`,
        { max_concurrent: 12 },
        'PUT',
        '/escalated/admin/capacity',
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/capacity');
      expect((await follow(res)).props.flash.success).toBe('Capacity updated.');
      expect(
        (await source.getRepository(AgentCapacity).findOneByOrFail({ id: capacity.id })).maxTickets,
      ).toBe(12);

      const errors = await errorsAfter(
        await submit(
          `/escalated/admin/capacity/${capacity.id}`,
          { max_concurrent: 0 },
          'PUT',
          '/escalated/admin/capacity',
        ),
      );
      expect(Object.keys(errors)).toEqual(['max_concurrent']);
    });
  });

  describe('audit log', () => {
    it('pages entries newest first with filters, users, actions and resource types', async () => {
      const logs = source.getRepository(AuditLog);
      await logs.clear();
      const older = await logs.save({
        userId: ADMIN,
        action: 'create',
        entityType: 'automation',
        entityId: 7,
        newValues: { name: 'Nudge' },
        ipAddress: '10.0.0.1',
      });
      await logs.update(older.id, { createdAt: new Date('2026-01-02T10:00:00Z') });
      const newer = await logs.save({
        userId: AGENT,
        action: 'update',
        entityType: 'skill',
        entityId: 3,
        oldValues: { name: 'A' },
        newValues: { name: 'B' },
      });

      const result = await page(base, '/escalated/admin/audit-log', asAdmin);
      expect(result.component).toBe('Escalated/Admin/AuditLog/Index');
      expectManifestProps(result);
      expect(result.props.logs.data.map((l: any) => l.id)).toEqual([newer.id, older.id]);
      expect(result.props.logs.data[1]).toEqual({
        id: older.id,
        user_id: ADMIN,
        user: { id: ADMIN, name: `Host user ${ADMIN}` },
        action: 'created',
        auditable_type: 'automation',
        auditable_id: 7,
        old_values: null,
        new_values: { name: 'Nudge' },
        ip_address: '10.0.0.1',
        user_agent: null,
        created_at: '2026-01-02T10:00:00.000Z',
      });
      expect(result.props.logs).toMatchObject({ current_page: 1, per_page: 50, total: 2 });
      expect(result.props.actions).toEqual(['created', 'updated', 'deleted']);
      expect([...result.props.resourceTypes].sort()).toEqual(['automation', 'skill']);
      expect(result.props.users).toEqual(
        expect.arrayContaining([
          { id: ADMIN, name: `Host user ${ADMIN}` },
          { id: AGENT, name: `Host user ${AGENT}` },
        ]),
      );
      expect(result.props.filters).toEqual({});

      const filtered = await page(
        base,
        `/escalated/admin/audit-log?action=updated&auditable_type=skill&user_id=${AGENT}`,
        asAdmin,
      );
      expect(filtered.props.logs.data.map((l: any) => l.id)).toEqual([newer.id]);
      expect(filtered.props.filters).toEqual({
        action: 'updated',
        auditable_type: 'skill',
        user_id: String(AGENT),
      });

      const dated = await page(
        base,
        '/escalated/admin/audit-log?date_from=2026-01-01&date_to=2026-01-02',
        asAdmin,
      );
      expect(dated.props.logs.data.map((l: any) => l.id)).toEqual([older.id]);
    });
  });
});
