import { DataSource, DataSourceOptions } from 'typeorm';
import * as entities from '../../src/entities';
import { Plugins1793318400000 } from '../../src/migrations/1793318400000-Plugins';

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

describe.each(databases)('plugins migration on %s', (_name, options) => {
  it('creates the activation and store tables, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'plg_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const pluginTable = source.getMetadata('EscalatedPlugin').tablePath;
    const storeTable = source.getMetadata('PluginStoreRecord').tablePath;
    const migration = new Plugins1793318400000();
    try {
      await migration.up(runner);

      const plugins = source.getRepository('EscalatedPlugin');
      const activatedAt = new Date('2026-10-29T10:00:00.000Z');
      await plugins.save({ slug: 'escalated-dev--plugin-slack', isActive: true, activatedAt });
      expect(await plugins.findOneByOrFail({ slug: 'escalated-dev--plugin-slack' })).toMatchObject({
        isActive: true,
        deactivatedAt: null,
      });
      // One row per slug.
      await expect(plugins.insert({ slug: 'escalated-dev--plugin-slack' })).rejects.toThrow();
      // The contract allows slugs up to 255 characters.
      await plugins.save({ slug: 'x'.repeat(255) });

      const store = source.getRepository('PluginStoreRecord');
      await store.save({
        plugin: '@escalated-dev/plugin-slack',
        collection: '__config__',
        key: '__config__',
        data: { token: 'xoxb', channels: ['#support'] },
      });
      await store.save({
        plugin: '@escalated-dev/plugin-slack',
        collection: 'threads',
        key: null,
        data: null,
      });
      const [config] = await store.find({ where: { collection: '__config__' } });
      expect(config).toMatchObject({ data: { token: 'xoxb', channels: ['#support'] } });

      await migration.down(runner);
      expect(await runner.hasTable(storeTable)).toBe(false);
      expect(await runner.hasTable(pluginTable)).toBe(false);
    } finally {
      for (const table of [storeTable, pluginTable]) {
        if (await runner.hasTable(table)) await runner.dropTable(table);
      }
      await runner.release();
      await source.destroy();
    }
  });
});
