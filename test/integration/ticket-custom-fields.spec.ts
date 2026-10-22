import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CustomField, CustomFieldValue, Ticket, TicketStatus } from '../../src/entities';
import { apiFetch, bootUi, cookieFrom, CUSTOMER, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * Ticket custom field values over real HTTP and SQLite (CUSTOM-FIELDS-SPEC
 * section 2): `custom_fields` keyed by slug on create and update, checked
 * before anything is written, and the decoded values on the show pages and
 * JSON details.
 */
describe('ticket custom field values', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let seq = 0;
  const f: Record<string, CustomField> = {};

  const tickets = () => source.getRepository(Ticket);
  const values = () => source.getRepository(CustomFieldValue);

  const subject = () => {
    seq += 1;
    return `Custom ${seq}`;
  };

  /** The stored strings of a ticket, by field slug. */
  const stored = async (ticketId: number) => {
    const rows = await values().find({ where: { entityType: 'ticket', entityId: ticketId } });
    const bySlug: Record<string, string> = {};
    for (const row of rows) {
      const field = Object.values(f).find((x) => x.id === row.customFieldId)!;
      bySlug[field.slug] = row.value;
    }
    return bySlug;
  };

  const agentCreate = (body: Record<string, unknown>) =>
    apiFetch(base, '/escalated/agent/tickets', {
      as: 'agent',
      body: { subject: subject(), description: 'Body', ...body },
    });

  const valid = {
    order_number: 'ORD-1',
    seats: '12',
    renewal: '2027-02-28',
    plan: 'pro',
    regions: ['eu', 'us'],
    vip: true,
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    await source
      .getRepository(TicketStatus)
      .save({ name: 'Open', slug: 'open', isDefault: true, sortOrder: 1 });
    const repo = source.getRepository(CustomField);
    const defs: Array<Partial<CustomField>> = [
      { name: 'Order number', slug: 'order_number', fieldType: 'text', isRequired: true },
      { name: 'Seats', slug: 'seats', fieldType: 'number' },
      { name: 'Renewal', slug: 'renewal', fieldType: 'date' },
      { name: 'Plan', slug: 'plan', fieldType: 'select', options: ['basic', 'pro'] },
      {
        name: 'Regions',
        slug: 'regions',
        fieldType: 'multi_select',
        options: ['eu', 'us', 'apac'],
      },
      { name: 'VIP', slug: 'vip', fieldType: 'checkbox' },
      { name: 'Notes', slug: 'notes', fieldType: 'textarea' },
      { name: 'Retired', slug: 'retired', fieldType: 'text', isActive: false },
      { name: 'Company size', slug: 'company_size', fieldType: 'text', entityType: 'organization' },
    ];
    for (const [position, def] of defs.entries()) {
      const saved = await repo.save({ ...def, sortOrder: position });
      f[saved.slug] = saved;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('create', () => {
    it('stores every value, encoded, from the agent API', async () => {
      const res = await agentCreate({ custom_fields: { ...valid, notes: 'Line\nbreak' } });
      expect(res.status).toBe(201);
      const ticket = await res.json();
      expect(await stored(ticket.id)).toEqual({
        order_number: 'ORD-1',
        seats: '12',
        renewal: '2027-02-28',
        plan: 'pro',
        regions: '["eu","us"]',
        vip: '1',
        notes: 'Line\nbreak',
      });
    });

    it('refuses a missing required field and creates no ticket', async () => {
      const before = await tickets().count();
      for (const body of [
        {},
        { custom_fields: { seats: 3 } },
        { custom_fields: { order_number: ' ' } },
      ]) {
        const res = await agentCreate(body);
        expect(res.status).toBe(422);
        expect((await res.json()).errors).toEqual({
          'custom_fields.order_number': 'The Order number field is required.',
        });
      }
      expect(await tickets().count()).toBe(before);
    });

    it.each([
      ['seats', 'lots', 'The Seats field must be a number.'],
      ['renewal', '2027-02-30', 'The Renewal field must be a valid date (YYYY-MM-DD).'],
      ['renewal', '28/02/2027', 'The Renewal field must be a valid date (YYYY-MM-DD).'],
      ['plan', 'enterprise', 'The selected Plan is invalid.'],
      ['regions', 'eu', 'The Regions field must be an array.'],
      ['regions', ['eu', 'mars'], 'The selected Regions is invalid.'],
      ['vip', 'maybe', 'The VIP field must be true or false.'],
      [
        'order_number',
        'x'.repeat(256),
        'The Order number field must not be greater than 255 characters.',
      ],
    ])('refuses an invalid %s (%j)', async (slug, value, message) => {
      const before = await tickets().count();
      const res = await agentCreate({ custom_fields: { ...valid, [slug]: value } });
      expect(res.status).toBe(422);
      expect((await res.json()).errors).toEqual({ [`custom_fields.${slug}`]: message });
      expect(await tickets().count()).toBe(before);
    });

    it('accepts checkbox spellings and stores 1 or 0', async () => {
      for (const [value, expected] of [
        [false, '0'],
        ['true', '1'],
        [0, '0'],
        ['1', '1'],
      ] as const) {
        const res = await agentCreate({ custom_fields: { order_number: 'A', vip: value } });
        expect(res.status).toBe(201);
        expect((await stored((await res.json()).id)).vip).toBe(expected);
      }
    });

    it('refuses unknown, inactive and other-context keys', async () => {
      const res = await agentCreate({
        custom_fields: { order_number: 'A', mystery: 'x', retired: 'x', company_size: '10' },
      });
      expect(res.status).toBe(422);
      expect(Object.keys((await res.json()).errors).sort()).toEqual([
        'custom_fields.company_size',
        'custom_fields.mystery',
        'custom_fields.retired',
      ]);
    });

    it('takes the older customFields keyed by field id, checked the same way', async () => {
      const refused = await agentCreate({ customFields: { [f.seats.id]: 'many' } });
      expect(refused.status).toBe(422);
      expect(Object.keys((await refused.json()).errors).sort()).toEqual([
        'custom_fields.order_number',
        'custom_fields.seats',
      ]);
      const res = await agentCreate({
        customFields: { [f.order_number.id]: 'OLD-1', [f.seats.id]: 4 },
      });
      expect(res.status).toBe(201);
      expect(await stored((await res.json()).id)).toEqual({ order_number: 'OLD-1', seats: '4' });
    });

    it('requires the fields on the customer API too', async () => {
      const refused = await apiFetch(base, '/escalated/customer/tickets', {
        as: 'customer',
        body: { subject: subject(), description: 'Body' },
      });
      expect(refused.status).toBe(422);
      const res = await apiFetch(base, '/escalated/customer/tickets', {
        as: 'customer',
        body: { subject: subject(), description: 'Body', custom_fields: { order_number: 'C-1' } },
      });
      expect(res.status).toBe(201);
      expect(await stored((await res.json()).id)).toEqual({ order_number: 'C-1' });
    });
  });

  describe('update', () => {
    const create = async () => {
      const res = await agentCreate({ custom_fields: valid });
      return (await res.json()).id as number;
    };
    const update = (id: number, body: Record<string, unknown>) =>
      apiFetch(base, `/escalated/agent/tickets/${id}`, { as: 'agent', method: 'PUT', body });

    it('changes only the keys sent, and nothing without custom_fields', async () => {
      const id = await create();
      expect((await update(id, { subject: 'Renamed' })).status).toBe(200);
      expect((await stored(id)).seats).toBe('12');

      expect((await update(id, { custom_fields: { seats: 20 } })).status).toBe(200);
      expect(await stored(id)).toMatchObject({ seats: '20', plan: 'pro', order_number: 'ORD-1' });
    });

    it('clears an optional value sent empty, and refuses a blank required one', async () => {
      const id = await create();
      expect((await update(id, { custom_fields: { plan: '', regions: [] } })).status).toBe(200);
      const after = await stored(id);
      expect(after.plan).toBeUndefined();
      expect(after.regions).toBeUndefined();

      const refused = await update(id, { custom_fields: { order_number: '', seats: 'x' } });
      expect(refused.status).toBe(422);
      expect(Object.keys((await refused.json()).errors).sort()).toEqual([
        'custom_fields.order_number',
        'custom_fields.seats',
      ]);
      expect(await stored(id)).toMatchObject({ order_number: 'ORD-1', seats: '12' });
    });

    it('writes nothing, not even the ticket, when a value is refused', async () => {
      const id = await create();
      const refused = await update(id, {
        subject: 'Should not stick',
        custom_fields: { plan: 'x' },
      });
      expect(refused.status).toBe(422);
      expect((await tickets().findOneByOrFail({ id })).subject).not.toBe('Should not stick');
    });
  });

  describe('reading', () => {
    let ticket: Ticket;

    beforeAll(async () => {
      const res = await apiFetch(base, '/escalated/customer/tickets', {
        as: 'customer',
        body: { subject: subject(), description: 'Body', custom_fields: valid },
      });
      ticket = await tickets().findOneByOrFail({ id: (await res.json()).id });
    });

    const expectValues = (customFields: any[]) => {
      expect(customFields.map((c) => c.slug)).toEqual([
        'order_number',
        'seats',
        'renewal',
        'plan',
        'regions',
        'vip',
        'notes',
      ]);
      const bySlug = Object.fromEntries(customFields.map((c) => [c.slug, c]));
      expect(bySlug.order_number).toEqual({
        id: f.order_number.id,
        name: 'Order number',
        slug: 'order_number',
        type: 'text',
        options: null,
        required: true,
        placeholder: null,
        description: null,
        position: 0,
        value: 'ORD-1',
      });
      expect(bySlug.seats.value).toBe(12);
      expect(bySlug.renewal.value).toBe('2027-02-28');
      expect(bySlug.regions).toMatchObject({ type: 'multi_select', value: ['eu', 'us'] });
      expect(bySlug.vip).toMatchObject({ type: 'checkbox', value: true });
      expect(bySlug.notes.value).toBeNull();
    };

    it('offers the active ticket fields on the customer create page', async () => {
      const result = await page(base, '/escalated/create', { as: 'customer' });
      expect(result.component).toBe('Escalated/Customer/Create');
      expect(result.props.custom_fields.map((c: any) => c.slug)).toEqual([
        'order_number',
        'seats',
        'renewal',
        'plan',
        'regions',
        'vip',
        'notes',
      ]);
      expect(Object.keys(result.props.custom_fields[0]).sort()).toEqual(
        [
          'id',
          'name',
          'slug',
          'type',
          'options',
          'required',
          'placeholder',
          'description',
          'position',
        ].sort(),
      );
    });

    it('sends the customer create form back with field errors, then creates', async () => {
      const before = await tickets().count();
      const res = await inertiaFetch(base, '/escalated', {
        as: 'customer',
        body: { subject: 'Form', description: 'x', custom_fields: { seats: 'x' } },
        headers: { referer: `${base}/escalated/create` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/create');
      const next = await page(base, '/escalated/create', {
        as: 'customer',
        headers: { cookie: cookieFrom(res) },
      });
      expect(Object.keys(next.props.errors).sort()).toEqual([
        'custom_fields.order_number',
        'custom_fields.seats',
      ]);
      expect(await tickets().count()).toBe(before);

      const ok = await inertiaFetch(base, '/escalated', {
        as: 'customer',
        body: { subject: 'Form ok', description: 'x', custom_fields: { order_number: 'F-1' } },
        headers: { referer: `${base}/escalated/create` },
      });
      expect(ok.status).toBe(303);
      const created = await tickets().findOneByOrFail({ subject: 'Form ok' });
      expect(await stored(created.id)).toEqual({ order_number: 'F-1' });
    });

    it('shows the decoded values on the customer, agent and admin ticket pages', async () => {
      const customer = await page(base, `/escalated/customer/tickets/${ticket.referenceNumber}`, {
        as: 'customer',
      });
      expect(customer.component).toBe('Escalated/Customer/Show');
      expectValues(customer.props.custom_fields);

      const agent = await page(base, `/escalated/agent/tickets/${ticket.referenceNumber}`, {
        as: 'agent',
      });
      expect(agent.component).toBe('Escalated/Agent/TicketShow');
      expectValues(agent.props.custom_fields);

      const admin = await page(base, `/escalated/admin/tickets/${ticket.referenceNumber}`, {
        as: 'admin',
      });
      expect(admin.component).toBe('Escalated/Admin/Tickets/Show');
      expectValues(admin.props.custom_fields);
    });

    it('adds custom_fields to the agent and customer JSON details', async () => {
      const agent = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}`, { as: 'agent' });
      expectValues((await agent.json()).ticket.custom_fields);
      const customer = await apiFetch(base, `/escalated/customer/tickets/${ticket.id}`, {
        as: 'customer',
      });
      expect(ticket.requesterId).toBe(CUSTOMER);
      expectValues((await customer.json()).ticket.custom_fields);
    });
  });
});
