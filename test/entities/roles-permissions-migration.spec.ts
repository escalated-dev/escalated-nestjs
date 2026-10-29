import { DataSource, DataSourceOptions } from 'typeorm';
import { Permission, Role } from '../../src/entities';
import { PERMISSIONS } from '../../src/access/permission-seed';
import { RolesAndPermissions1793404800000 } from '../../src/migrations/1793404800000-RolesAndPermissions';

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

describe.each(databases)('roles and permissions migration on %s', (_name, options) => {
  it('seeds the permissions and system roles idempotently, keeping custom roles', async () => {
    const source = new DataSource({
      ...options,
      entities: [Role, Permission],
      entityPrefix: 'rp_mig_',
      synchronize: true,
    } as DataSourceOptions);
    await source.initialize();
    const tables = [
      source.getMetadata(Role).manyToManyRelations[0].junctionEntityMetadata!.tablePath,
      source.getMetadata(Role).tablePath,
      source.getMetadata(Permission).tablePath,
    ];
    try {
      const custom = await source.getRepository(Role).save({ name: 'Mine', slug: 'mine' });
      const migration = new RolesAndPermissions1793404800000();
      await migration.up(source.createQueryRunner());
      await migration.up(source.createQueryRunner());

      expect(await source.getRepository(Permission).count()).toBe(PERMISSIONS.length);
      const roles = await source.getRepository(Role).find({ relations: { permissions: true } });
      const bySlug = Object.fromEntries(roles.map((r) => [r.slug, r]));
      expect(Object.keys(bySlug).sort()).toEqual(['admin', 'agent', 'light_agent', 'mine']);
      expect(bySlug.admin.permissions).toHaveLength(PERMISSIONS.length);
      expect(bySlug.admin.isSystem).toBe(true);
      expect(bySlug.light_agent.permissions.map((p) => p.slug).sort()).toEqual(
        [
          'kb.view',
          'macro.view',
          'reply.create',
          'reply.create_internal',
          'tag.view',
          'ticket.view',
        ].sort(),
      );
      expect(bySlug.agent.permissions.map((p) => p.slug)).toContain('ticket.close');
      expect(bySlug.agent.permissions.map((p) => p.slug)).not.toContain('settings.manage');
      expect(bySlug.mine.id).toBe(custom.id);
      expect(bySlug.mine.permissions).toEqual([]);
    } finally {
      const runner = source.createQueryRunner();
      for (const table of tables) {
        if (await runner.hasTable(table)) await runner.dropTable(table, true, true, true);
      }
      await runner.release();
      await source.destroy();
    }
  });
});
