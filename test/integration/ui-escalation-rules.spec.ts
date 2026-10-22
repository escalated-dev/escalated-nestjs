import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { EscalationRule, RuleExecution, SlaPolicy, Ticket, TicketStatus } from '../../src/entities';
import { ESCALATED_EVENTS } from '../../src/events/escalated.events';
import { EscalationService } from '../../src/services/escalation.service';
import {
  bootUi,
  cookieFrom,
  CUSTOMER,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The escalation rule screens over real HTTP and SQLite, with
 * escalated-laravel's EscalationRuleController as the prop contract, and the
 * rules they save run by the escalation sweep (EscalationService) once per
 * ticket, as Laravel's RuleFireLog.
 */
describe('escalation rule screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let escalatedStatus: TicketStatus;
  let sweep: EscalationService;
  const escalations: Array<{ ticket: Ticket; reason: string }> = [];

  const asAdmin = { as: 'admin' as const };
  const rules = () => source.getRepository(EscalationRule);
  const tickets = () => source.getRepository(Ticket);

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

  let counter = 0;
  const ticket = (data: Partial<Ticket> = {}) =>
    tickets().save({
      referenceNumber: `ESC-R-${++counter}`,
      subject: 'Needs help',
      description: 'x',
      priority: 'high',
      channel: 'web',
      statusId: open.id,
      requesterId: CUSTOMER,
      ...data,
    } as Partial<Ticket>);

  /** Only this rule active, so each test sees its own sweep. */
  const only = async (rule: EscalationRule) => {
    await rules().createQueryBuilder().update().set({ isActive: false }).execute();
    await rules().update(rule.id, { isActive: true });
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true, sortOrder: 1 });
    escalatedStatus = await statuses.save({ name: 'Escalated', slug: 'escalated', sortOrder: 2 });
    sweep = app.get(EscalationService);
    app.get(EventEmitter2).on(ESCALATED_EVENTS.TICKET_ESCALATED, (event: any) => {
      escalations.push({ ticket: event.ticket, reason: event.reason });
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the screens behind the admin guard', async () => {
    expect(
      (await inertiaFetch(base, '/escalated/admin/escalation-rules', { as: 'agent' })).status,
    ).toBe(403);
  });

  it('lists rules as the Laravel model serializes them, earlier rules in the new shape', async () => {
    const policy = await source.getRepository(SlaPolicy).save({ name: 'Gold' });
    const legacy = await rules().save({
      slaPolicyId: policy.id,
      name: 'Breached first response',
      triggerType: 'first_response_breach',
      conditions: { ticket_type: 'incident' },
      actions: [{ type: 'set_priority', value: 'urgent' }],
      sortOrder: 2,
    });

    const result = await page(base, '/escalated/admin/escalation-rules', asAdmin);
    expect(result.component).toBe('Escalated/Admin/EscalationRules/Index');
    expectManifestProps(result);
    expect(result.props.rules).toContainEqual({
      id: legacy.id,
      name: 'Breached first response',
      description: null,
      trigger_type: 'first_response_breach',
      conditions: [
        { field: 'sla_policy_id', value: policy.id },
        { field: 'first_response_breached', value: true },
        { field: 'ticket_type', value: 'incident' },
      ],
      actions: [{ type: 'change_priority', value: 'urgent' }],
      order: 2,
      is_active: true,
      repeat_after_hours: null,
      category: null,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it('creates a rule from the form, and the sweep runs it once per ticket', async () => {
    const form = await page(base, '/escalated/admin/escalation-rules/create', asAdmin);
    expect(form.component).toBe('Escalated/Admin/EscalationRules/Form');
    expectManifestProps(form);
    expect(form.props.rule).toBeNull();

    const res = await submit('/escalated/admin/escalation-rules', {
      name: 'Unanswered high priority',
      description: '',
      trigger_type: 'time_based',
      conditions: [
        { field: 'priority', value: 'high' },
        { field: 'no_response_hours', value: '2' },
      ],
      actions: [
        { type: 'escalate', value: '' },
        { type: 'change_priority', value: 'urgent' },
      ],
      order: 1,
      is_active: true,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/escalated/admin/escalation-rules');
    expect((await follow(res)).props.flash.success).toBe('Escalation rule created.');

    const rule = await rules().findOneByOrFail({ name: 'Unanswered high priority' });
    expect(rule).toMatchObject({ triggerType: 'time_based', sortOrder: 1, slaPolicyId: null });
    await only(rule);

    const old = new Date(Date.now() - 3 * 3_600_000);
    const due = await ticket();
    await tickets().update(due.id, { createdAt: old });
    const fresh = await ticket();
    const answered = await ticket({ firstRespondedAt: new Date() } as Partial<Ticket>);
    await tickets().update(answered.id, { createdAt: old });

    escalations.length = 0;
    expect(await sweep.processEscalations()).toBe(1);
    expect(await sweep.processEscalations()).toBe(0);

    expect(await tickets().findOneByOrFail({ id: due.id })).toMatchObject({
      statusId: escalatedStatus.id,
      priority: 'urgent',
    });
    expect((await tickets().findOneByOrFail({ id: fresh.id })).priority).toBe('high');
    expect((await tickets().findOneByOrFail({ id: answered.id })).priority).toBe('high');
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      ticket: { id: due.id },
      reason: 'Escalation rule: Unanswered high priority',
    });
  });

  it('fires again only after the ticket stops matching, or after repeat_after_hours', async () => {
    const res = await submit('/escalated/admin/escalation-rules', {
      name: 'Unassigned',
      trigger_type: 'time_based',
      conditions: [{ field: 'assigned', value: 'unassigned' }],
      actions: [{ type: 'change_priority', value: 'low' }],
    });
    expect(res.status).toBe(303);
    const rule = await rules().findOneByOrFail({ name: 'Unassigned' });
    await only(rule);
    const target = await ticket();
    const priority = async () => (await tickets().findOneByOrFail({ id: target.id })).priority;
    const reset = () => tickets().update(target.id, { priority: 'high' });

    await sweep.processEscalations();
    expect(await priority()).toBe('low');

    // Still matching: the rule does not act again.
    await reset();
    await sweep.processEscalations();
    expect(await priority()).toBe('high');

    // Stops matching (assigned), which re-arms it; matches again (unassigned).
    await tickets().update(target.id, { assigneeId: 5 } as any);
    await sweep.processEscalations();
    await tickets().update(target.id, { assigneeId: null } as any);
    await sweep.processEscalations();
    expect(await priority()).toBe('low');

    // With repeat_after_hours, it acts again once that long has passed.
    await reset();
    await rules().update(rule.id, { repeatAfterHours: 2 });
    await sweep.processEscalations();
    expect(await priority()).toBe('high');
    await source
      .getRepository(RuleExecution)
      .update(
        { ruleId: rule.id, ticketId: target.id },
        { firedAt: new Date(Date.now() - 3 * 3_600_000) },
      );
    await sweep.processEscalations();
    expect(await priority()).toBe('low');
  });

  it('edits an earlier rule through the form without changing what it matches', async () => {
    const policy = await source.getRepository(SlaPolicy).save({ name: 'Silver' });
    const legacy = await rules().save({
      slaPolicyId: policy.id,
      name: 'Old style',
      triggerType: 'resolution_breach',
      conditions: null,
      actions: [{ type: 'set_priority', value: 'urgent' }],
    });
    await only(legacy);

    const edit = await page(base, `/escalated/admin/escalation-rules/${legacy.id}/edit`, asAdmin);
    expect(edit.component).toBe('Escalated/Admin/EscalationRules/Form');
    expectManifestProps(edit);
    const { rule } = edit.props;
    expect(rule).toMatchObject({ id: legacy.id, name: 'Old style' });

    // The form posts back what it was given.
    const res = await submit(
      `/escalated/admin/escalation-rules/${legacy.id}`,
      {
        name: 'Old style, edited',
        description: rule.description ?? '',
        trigger_type: rule.trigger_type,
        conditions: rule.conditions,
        actions: rule.actions,
        order: rule.order,
        is_active: rule.is_active,
      },
      'PUT',
      `/escalated/admin/escalation-rules/${legacy.id}/edit`,
    );
    expect(res.status).toBe(303);
    expect((await follow(res)).props.flash.success).toBe('Escalation rule updated.');
    const saved = await rules().findOneByOrFail({ id: legacy.id });
    expect(saved).toMatchObject({
      name: 'Old style, edited',
      slaPolicyId: null,
      conditions: [
        { field: 'sla_policy_id', value: policy.id },
        { field: 'resolution_breached', value: true },
      ],
      actions: [{ type: 'change_priority', value: 'urgent' }],
    });

    const overdue = new Date(Date.now() - 60_000);
    const covered = await ticket({ slaPolicyId: policy.id, resolutionDueAt: overdue } as any);
    const otherPolicy = await ticket({ resolutionDueAt: overdue } as any);
    await sweep.processEscalations();
    expect((await tickets().findOneByOrFail({ id: covered.id })).priority).toBe('urgent');
    expect((await tickets().findOneByOrFail({ id: otherPolicy.id })).priority).toBe('high');
  });

  it('sends a rule without conditions back with an error', async () => {
    const res = await submit(
      '/escalated/admin/escalation-rules',
      { name: 'Empty', trigger_type: 'time_based', conditions: [], actions: [] },
      'POST',
      '/escalated/admin/escalation-rules/create',
    );
    expect(res.headers.get('location')).toBe('/escalated/admin/escalation-rules/create');
    expect(Object.keys((await follow(res)).props.errors)).toEqual(['conditions']);
  });

  it('deletes a rule and forgets where it fired', async () => {
    const rule = await rules().save({
      name: 'Doomed',
      triggerType: 'time_based',
      conditions: [{ field: 'priority', value: 'medium' }],
      actions: [{ type: 'change_priority', value: 'low' }],
    });
    await only(rule);
    await ticket({ priority: 'medium' });
    await sweep.processEscalations();
    expect(await source.getRepository(RuleExecution).countBy({ ruleId: rule.id })).toBe(1);

    const res = await submit(`/escalated/admin/escalation-rules/${rule.id}`, undefined, 'DELETE');
    expect(res.status).toBe(303);
    expect((await follow(res)).props.flash.success).toBe('Escalation rule deleted.');
    expect(await rules().countBy({ id: rule.id })).toBe(0);
    expect(await source.getRepository(RuleExecution).countBy({ ruleId: rule.id })).toBe(0);
  });
});
