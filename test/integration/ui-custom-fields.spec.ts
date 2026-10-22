import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CustomField,
  CustomFieldValue,
  CustomObject,
  CustomObjectRecord,
} from '../../src/entities';
import {
  apiFetch,
  bootUi,
  cookieFrom,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The custom field and custom object admin screens over real HTTP and SQLite,
 * with escalated-laravel's Admin\CustomFieldController and
 * Admin\CustomObjectController as the prop and route contract.
 */
describe('custom field and custom object screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;

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

  const fields = () => source.getRepository(CustomField);
  const objects = () => source.getRepository(CustomObject);
  const records = () => source.getRepository(CustomObjectRecord);

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const entity of [CustomFieldValue, CustomObjectRecord, CustomObject, CustomField]) {
      await source.getRepository(entity).createQueryBuilder().delete().execute();
    }
  });

  it('keeps the screens behind the admin guard', async () => {
    for (const path of [
      '/escalated/admin/custom-fields',
      '/escalated/admin/custom-fields/create',
      '/escalated/admin/custom-objects',
      '/escalated/admin/custom-objects/create',
    ]) {
      expect((await inertiaFetch(base, path, { as: 'agent' })).status).toBe(403);
    }
  });

  it('names every route the screens call', async () => {
    const result = await page(base, '/escalated/admin/custom-fields', asAdmin);
    const routes = Object.keys(result.props.ziggy.routes);
    for (const action of ['index', 'create', 'store', 'edit', 'update', 'destroy', 'reorder']) {
      expect(routes).toContain(`escalated.admin.custom-fields.${action}`);
    }
    for (const action of [
      'index',
      'create',
      'store',
      'edit',
      'update',
      'destroy',
      'records',
      'records.store',
      'records.update',
      'records.destroy',
    ]) {
      expect(routes).toContain(`escalated.admin.custom-objects.${action}`);
    }
  });

  describe('Escalated/Admin/CustomFields', () => {
    it('lists every field by position with Laravel keys', async () => {
      await fields().save([
        { name: 'Second', slug: 'second', fieldType: 'text', sortOrder: 2, isActive: false },
        {
          name: 'First',
          slug: 'first',
          fieldType: 'multiselect',
          options: ['a', 'b'],
          sortOrder: 1,
          isRequired: true,
          entityType: 'ticket',
        },
      ]);

      const result = await page(base, '/escalated/admin/custom-fields', asAdmin);
      expect(result.component).toBe('Escalated/Admin/CustomFields/Index');
      expectManifestProps(result);
      expect(result.props.fields.map((f: any) => f.slug)).toEqual(['first', 'second']);
      const [first, second] = result.props.fields;
      expect(Object.keys(first).sort()).toEqual(
        [
          'id',
          'name',
          'slug',
          'type',
          'context',
          'options',
          'required',
          'placeholder',
          'description',
          'validation_rules',
          'conditions',
          'position',
          'active',
          'created_at',
          'updated_at',
        ].sort(),
      );
      expect(first).toMatchObject({
        name: 'First',
        type: 'multi_select',
        context: 'ticket',
        options: ['a', 'b'],
        required: true,
        position: 1,
        active: true,
      });
      expect(second).toMatchObject({ active: false, required: false, position: 2 });
    });

    it('renders the create and edit forms with the contexts', async () => {
      const create = await page(base, '/escalated/admin/custom-fields/create', asAdmin);
      expect(create.component).toBe('Escalated/Admin/CustomFields/Form');
      expectManifestProps(create);
      expect(create.props.field).toBeNull();
      expect(create.props.contexts).toEqual(['ticket', 'user', 'organization']);

      const field = await fields().save({ name: 'Plan', slug: 'plan', fieldType: 'text' });
      const edit = await page(base, `/escalated/admin/custom-fields/${field.id}/edit`, asAdmin);
      expect(edit.component).toBe('Escalated/Admin/CustomFields/Form');
      expect(edit.props.contexts).toEqual(['ticket', 'user', 'organization']);
      expect(edit.props.field).toMatchObject({ id: field.id, name: 'Plan', type: 'text' });
    });

    it('creates a field with a slug from its name, de-duplicated', async () => {
      const body = {
        name: 'Order Number',
        type: 'text',
        context: 'ticket',
        options: [],
        required: true,
        placeholder: 'ORD-123',
        description: 'From the receipt',
        position: 3,
        active: true,
      };
      const res = await submit('/escalated/admin/custom-fields', body);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/custom-fields');
      expect((await follow(res)).props.flash.success).toBe('Custom field created.');
      await submit('/escalated/admin/custom-fields', body);
      await submit('/escalated/admin/custom-fields', body);

      const saved = await fields().find({ order: { id: 'ASC' } });
      expect(saved.map((f) => f.slug)).toEqual([
        'order_number',
        'order_number_2',
        'order_number_3',
      ]);
      expect(saved[0]).toMatchObject({
        name: 'Order Number',
        fieldType: 'text',
        entityType: 'ticket',
        isRequired: true,
        placeholder: 'ORD-123',
        description: 'From the receipt',
        sortOrder: 3,
        isActive: true,
      });
    });

    it('refuses invalid fields with field errors and saves nothing', async () => {
      const res = await submit(
        '/escalated/admin/custom-fields',
        { name: '', type: 'colour', context: 'planet' },
        'POST',
        '/escalated/admin/custom-fields/create',
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/custom-fields/create');
      expect(Object.keys((await follow(res)).props.errors).sort()).toEqual([
        'context',
        'name',
        'type',
      ]);

      const select = await submit(
        '/escalated/admin/custom-fields',
        { name: 'Tier', type: 'select', options: ['', '  '] },
        'POST',
        '/escalated/admin/custom-fields/create',
      );
      expect((await follow(select)).props.errors).toEqual({
        options: 'Select fields need at least one option.',
      });
      expect(await fields().count()).toBe(0);
    });

    it('updates, reorders and deletes a field, and its values go with it', async () => {
      const field = await fields().save({
        name: 'Tier',
        slug: 'tier',
        fieldType: 'select',
        options: ['gold'],
      });
      const other = await fields().save({ name: 'Other', slug: 'other', fieldType: 'text' });

      const res = await submit(
        `/escalated/admin/custom-fields/${field.id}`,
        {
          name: 'Plan tier',
          type: 'select',
          context: 'ticket',
          options: ['gold', 'silver'],
          required: true,
          placeholder: '',
          description: '',
          position: 5,
          active: false,
        },
        'PUT',
      );
      expect(res.status).toBe(303);
      expect((await follow(res)).props.flash.success).toBe('Custom field updated.');
      expect(await fields().findOneByOrFail({ id: field.id })).toMatchObject({
        name: 'Plan tier',
        slug: 'tier',
        options: ['gold', 'silver'],
        isRequired: true,
        sortOrder: 5,
        isActive: false,
      });

      const reordered = await submit(
        '/escalated/admin/custom-fields/reorder',
        {
          positions: [
            { id: field.id, position: 2 },
            { id: other.id, position: 1 },
          ],
        },
        'POST',
        '/escalated/admin/custom-fields',
      );
      expect(reordered.status).toBe(303);
      expect((await fields().findOneByOrFail({ id: other.id })).sortOrder).toBe(1);
      expect((await fields().findOneByOrFail({ id: field.id })).sortOrder).toBe(2);
      const badOrder = await submit(
        '/escalated/admin/custom-fields/reorder',
        { positions: [{ id: 999999, position: 1 }] },
        'POST',
        '/escalated/admin/custom-fields',
      );
      expect(Object.keys((await follow(badOrder)).props.errors)).toEqual(['positions']);

      await source
        .getRepository(CustomFieldValue)
        .save({ customFieldId: field.id, entityType: 'ticket', entityId: 1, value: 'gold' });
      const removed = await submit(
        `/escalated/admin/custom-fields/${field.id}`,
        undefined,
        'DELETE',
      );
      expect(removed.status).toBe(303);
      expect(removed.headers.get('location')).toBe('/escalated/admin/custom-fields');
      expect(await fields().countBy({ id: field.id })).toBe(0);
      expect(
        await source.getRepository(CustomFieldValue).countBy({ customFieldId: field.id }),
      ).toBe(0);
    });

    it('keeps the JSON API for API clients', async () => {
      const created = await apiFetch(base, '/escalated/admin/custom-fields', {
        as: 'admin',
        body: { name: 'Api', slug: 'api', fieldType: 'number', entityType: 'ticket' },
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ slug: 'api', fieldType: 'number' });
      const list = await apiFetch(base, '/escalated/admin/custom-fields', { as: 'admin' });
      expect((await list.json()).map((f: any) => f.slug)).toEqual(['api']);
    });
  });

  describe('Escalated/Admin/CustomObjects', () => {
    const schema = [
      { name: 'Serial', type: 'text', required: true },
      { name: 'Seats', type: 'number' },
      { name: 'Renews', type: 'date' },
      { name: 'Plan', type: 'select', options: ['basic', 'pro'] },
    ];

    it('lists objects by name with their record counts', async () => {
      const zeta = await objects().save({
        name: 'Zeta',
        slug: 'zeta',
        fieldsSchema: schema as any,
      });
      await objects().save({ name: 'Alpha', slug: 'alpha', fieldsSchema: schema as any });
      await records().save([
        { objectId: zeta.id, data: { Serial: 'a' } },
        { objectId: zeta.id, data: { Serial: 'b' } },
      ]);

      const result = await page(base, '/escalated/admin/custom-objects', asAdmin);
      expect(result.component).toBe('Escalated/Admin/CustomObjects/Index');
      expectManifestProps(result);
      expect(result.props.objects.map((o: any) => [o.name, o.records_count])).toEqual([
        ['Alpha', 0],
        ['Zeta', 2],
      ]);
      expect(Object.keys(result.props.objects[0]).sort()).toEqual(
        ['id', 'name', 'slug', 'fields_schema', 'records_count', 'created_at', 'updated_at'].sort(),
      );
      expect(result.props.objects[1].fields_schema).toEqual(schema);
    });

    it('creates, edits and deletes an object, with its records', async () => {
      const create = await page(base, '/escalated/admin/custom-objects/create', asAdmin);
      expect(create.component).toBe('Escalated/Admin/CustomObjects/Form');
      expectManifestProps(create);
      expect(create.props.object).toBeNull();

      const res = await submit('/escalated/admin/custom-objects', {
        name: 'Licenses',
        slug: 'licenses',
        fields_schema: schema,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/custom-objects');
      expect((await follow(res)).props.flash.success).toBe('Custom object created.');
      const object = await objects().findOneByOrFail({ slug: 'licenses' });
      expect(object.fieldsSchema).toEqual(schema);

      const edit = await page(base, `/escalated/admin/custom-objects/${object.id}/edit`, asAdmin);
      expect(edit.component).toBe('Escalated/Admin/CustomObjects/Form');
      expect(edit.props.object).toMatchObject({
        id: object.id,
        name: 'Licenses',
        slug: 'licenses',
        fields_schema: schema,
      });

      const updated = await submit(
        `/escalated/admin/custom-objects/${object.id}`,
        { name: 'Seats', slug: 'licenses', fields_schema: [{ name: 'Serial', type: 'text' }] },
        'PUT',
      );
      expect((await follow(updated)).props.flash.success).toBe('Custom object updated.');
      expect(await objects().findOneByOrFail({ id: object.id })).toMatchObject({
        name: 'Seats',
        fieldsSchema: [{ name: 'Serial', type: 'text' }],
      });

      await records().save({ objectId: object.id, data: { Serial: 'x' } });
      const removed = await submit(
        `/escalated/admin/custom-objects/${object.id}`,
        undefined,
        'DELETE',
      );
      expect((await follow(removed)).props.flash.success).toBe('Custom object deleted.');
      expect(await objects().countBy({ id: object.id })).toBe(0);
      expect(await records().countBy({ objectId: object.id })).toBe(0);
    });

    it('refuses a duplicate slug, a bad slug and an empty or invalid schema', async () => {
      await objects().save({ name: 'Taken', slug: 'taken', fieldsSchema: schema as any });
      const dup = await submit(
        '/escalated/admin/custom-objects',
        { name: 'Again', slug: 'taken', fields_schema: schema },
        'POST',
        '/escalated/admin/custom-objects/create',
      );
      expect(dup.headers.get('location')).toBe('/escalated/admin/custom-objects/create');
      expect((await follow(dup)).props.errors).toEqual({
        slug: 'The slug has already been taken.',
      });

      const bad = await submit(
        '/escalated/admin/custom-objects',
        {
          name: '',
          slug: 'has spaces',
          fields_schema: [{ name: '', type: 'colour' }],
        },
        'POST',
        '/escalated/admin/custom-objects/create',
      );
      expect(Object.keys((await follow(bad)).props.errors).sort()).toEqual([
        'fields_schema.0.name',
        'fields_schema.0.type',
        'name',
        'slug',
      ]);
      const empty = await submit(
        '/escalated/admin/custom-objects',
        { name: 'Empty', slug: 'empty', fields_schema: [] },
        'POST',
        '/escalated/admin/custom-objects/create',
      );
      expect(Object.keys((await follow(empty)).props.errors)).toEqual(['fields_schema']);
      expect(await objects().count()).toBe(1);
    });

    it('lists records newest first and validates their data against the schema', async () => {
      const object = await objects().save({
        name: 'Licenses',
        slug: 'licenses',
        fieldsSchema: schema as any,
      });
      const recordsPath = `/escalated/admin/custom-objects/${object.id}/records`;

      const added = await submit(recordsPath, {
        data: { Serial: 'ABC', Seats: '5', Renews: '2027-02-28', Plan: 'pro' },
      });
      expect(added.status).toBe(303);
      expect(added.headers.get('location')).toBe(recordsPath);
      expect((await follow(added)).props.flash.success).toBe('Record created.');
      await submit(recordsPath, { data: { Serial: 'DEF', Seats: '', Renews: '', Plan: '' } });

      const result = await page(base, recordsPath, asAdmin);
      expect(result.component).toBe('Escalated/Admin/CustomObjects/Records');
      expectManifestProps(result);
      expect(result.props.object).toMatchObject({
        id: object.id,
        name: 'Licenses',
        fields_schema: schema,
      });
      expect(result.props.records.map((r: any) => r.data.Serial)).toEqual(['DEF', 'ABC']);
      expect(Object.keys(result.props.records[0]).sort()).toEqual(
        ['id', 'object_id', 'data', 'created_at', 'updated_at'].sort(),
      );

      const refused = await submit(recordsPath, {
        data: { Serial: '', Seats: 'many', Renews: '2027-02-30', Plan: 'enterprise', Extra: 'x' },
      });
      expect(Object.keys((await follow(refused)).props.errors).sort()).toEqual([
        'data.Extra',
        'data.Plan',
        'data.Renews',
        'data.Seats',
        'data.Serial',
      ]);
      const notObject = await submit(recordsPath, { data: 'nope' });
      expect(Object.keys((await follow(notObject)).props.errors)).toEqual(['data']);
      expect(await records().countBy({ objectId: object.id })).toBe(2);

      const abc = await records().findOneByOrFail({
        objectId: object.id,
        id: result.props.records[1].id,
      });
      const edited = await submit(
        `${recordsPath}/${abc.id}`,
        { data: { Serial: 'ABC-2', Seats: 7 } },
        'PUT',
        recordsPath,
      );
      expect((await follow(edited)).props.flash.success).toBe('Record updated.');
      expect((await records().findOneByOrFail({ id: abc.id })).data).toEqual({
        Serial: 'ABC-2',
        Seats: 7,
      });

      const deleted = await submit(`${recordsPath}/${abc.id}`, undefined, 'DELETE', recordsPath);
      expect((await follow(deleted)).props.flash.success).toBe('Record deleted.');
      expect(await records().countBy({ id: abc.id })).toBe(0);
    });

    it('answers 404 for a record reached through another object', async () => {
      const one = await objects().save({ name: 'One', slug: 'one', fieldsSchema: schema as any });
      const two = await objects().save({ name: 'Two', slug: 'two', fieldsSchema: schema as any });
      const record = await records().save({ objectId: one.id, data: { Serial: 'a' } });

      const path = `/escalated/admin/custom-objects/${two.id}/records/${record.id}`;
      const res = await apiFetch(base, path, { as: 'admin', method: 'PUT', body: { data: {} } });
      expect(res.status).toBe(404);
      const del = await apiFetch(base, path, { as: 'admin', method: 'DELETE' });
      expect(del.status).toBe(404);
      // A screen form gets the error back instead of a change.
      const screen = await submit(
        path,
        { data: { Serial: 'b' } },
        'PUT',
        `/escalated/admin/custom-objects/${two.id}/records`,
      );
      expect((await follow(screen)).props.flash.error).toBeTruthy();
      expect((await records().findOneByOrFail({ id: record.id })).data).toEqual({ Serial: 'a' });
    });

    it('serves the same routes as JSON, with 422 for invalid input', async () => {
      const created = await apiFetch(base, '/escalated/admin/custom-objects', {
        as: 'admin',
        body: { name: 'Assets', slug: 'assets', fields_schema: schema },
      });
      expect(created.status).toBe(201);
      const object = await created.json();
      expect(object).toMatchObject({ name: 'Assets', slug: 'assets', fields_schema: schema });

      const invalid = await apiFetch(base, `/escalated/admin/custom-objects/${object.id}/records`, {
        as: 'admin',
        body: { data: { Seats: 'x' } },
      });
      expect(invalid.status).toBe(422);
      expect(Object.keys((await invalid.json()).errors).sort()).toEqual([
        'data.Seats',
        'data.Serial',
      ]);

      const record = await apiFetch(base, `/escalated/admin/custom-objects/${object.id}/records`, {
        as: 'admin',
        body: { data: { Serial: 'S1' } },
      });
      expect(record.status).toBe(201);
      const listed = await apiFetch(base, `/escalated/admin/custom-objects/${object.id}/records`, {
        as: 'admin',
      });
      const body = await listed.json();
      expect(body.object.slug).toBe('assets');
      expect(body.records.map((r: any) => r.data)).toEqual([{ Serial: 'S1' }]);
      const index = await apiFetch(base, '/escalated/admin/custom-objects', { as: 'admin' });
      expect((await index.json()).map((o: any) => o.records_count)).toEqual([1]);
    });
  });
});
