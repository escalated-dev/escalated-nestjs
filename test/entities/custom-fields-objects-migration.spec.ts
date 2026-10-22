import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { CustomFieldsAndObjects1792972800000 } from '../../src/migrations/1792972800000-CustomFieldsAndObjects';

jest.setTimeout(60000);

const databases: Array<[string, DataSourceOptions]> = [
  ['SQLite', { type: 'better-sqlite3', database: ':memory:' }],
];
if (process.env.ESCALATED_TEST_POSTGRES_URL)
  databases.push([
    'PostgreSQL',
    { type: 'postgres', url: process.env.ESCALATED_TEST_POSTGRES_URL },
  ]);
if (process.env.ESCALATED_TEST_MYSQL_URL)
  databases.push(['MySQL', { type: 'mysql', url: process.env.ESCALATED_TEST_MYSQL_URL }]);

describe.each(databases)('custom fields and objects migration on %s', (_name, options) => {
  it('adds the definition columns, creates the object tables, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'cf_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const fieldTable = source.getMetadata('CustomField').tablePath;
    const objectTable = source.getMetadata('CustomObject').tablePath;
    const recordTable = source.getMetadata('CustomObjectRecord').tablePath;
    const e = (value: string) => source.driver.escape(value);
    try {
      // The definitions table as earlier releases created it, with a row.
      await runner.createTable(
        new Table({
          name: fieldTable,
          columns: [
            { name: 'id', type: 'int', isPrimary: true },
            { name: 'name', type: 'varchar', length: '255' },
            { name: 'slug', type: 'varchar', length: '255' },
            { name: 'fieldType', type: 'varchar', length: '50' },
            { name: 'options', type: 'text', isNullable: true },
            { name: 'isRequired', type: 'boolean', default: false },
            { name: 'entityType', type: 'varchar', length: '100', default: "'ticket'" },
            { name: 'sortOrder', type: 'int', default: 0 },
            { name: 'isActive', type: 'boolean', default: true },
          ],
        }),
      );
      await runner.query(
        `INSERT INTO ${e(fieldTable)} (${e('id')}, ${e('name')}, ${e('slug')}, ${e('fieldType')}, ${e('options')}) ` +
          `VALUES (1, 'Plan', 'plan', 'select', '["gold"]')`,
      );
      const migration = new CustomFieldsAndObjects1792972800000();

      await migration.up(runner);
      for (const column of ['placeholder', 'description', 'validationRules', 'conditions']) {
        expect(await runner.hasColumn(fieldTable, column)).toBe(true);
      }
      const [kept] = await runner.query(
        `SELECT ${e('slug')} AS slug, ${e('options')} AS options, ${e('placeholder')} AS placeholder ` +
          `FROM ${e(fieldTable)}`,
      );
      expect(kept).toEqual({ slug: 'plan', options: '["gold"]', placeholder: null });

      // The new tables take rows through the entities.
      const object = await source.getRepository('CustomObject').save({
        name: 'Licenses',
        slug: 'licenses',
        fieldsSchema: [{ name: 'Serial', type: 'text' }],
      });
      await source
        .getRepository('CustomObjectRecord')
        .save({ objectId: object.id, data: { Serial: 'ABC' } });
      const [record] = await source.getRepository('CustomObjectRecord').find();
      expect(record).toMatchObject({ objectId: object.id, data: { Serial: 'ABC' } });

      // Slugs are unique, and records go with their object.
      await expect(
        source
          .getRepository('CustomObject')
          .insert({ name: 'Again', slug: 'licenses', fieldsSchema: [] }),
      ).rejects.toThrow();
      await runner.query(`DELETE FROM ${e(objectTable)} WHERE ${e('id')} = ${object.id}`);
      expect(await source.getRepository('CustomObjectRecord').count()).toBe(0);

      await migration.down(runner);
      expect(await runner.hasTable(recordTable)).toBe(false);
      expect(await runner.hasTable(objectTable)).toBe(false);
      for (const column of ['placeholder', 'description', 'validationRules', 'conditions']) {
        expect(await runner.hasColumn(fieldTable, column)).toBe(false);
      }
      const rows = await runner.query(`SELECT ${e('id')} AS id FROM ${e(fieldTable)}`);
      expect(rows).toHaveLength(1);
    } finally {
      for (const table of [recordTable, objectTable, fieldTable]) {
        if (await runner.hasTable(table)) await runner.dropTable(table);
      }
      await runner.release();
      await source.destroy();
    }
  });
});
