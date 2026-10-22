import { createHash } from 'crypto';
import { DataSource, DataSourceOptions, Table } from 'typeorm';
import * as entities from '../../src/entities';
import { ApiToken } from '../../src/entities';
import { HashApiTokens1793145600000 } from '../../src/migrations/1793145600000-HashApiTokens';
import { ApiTokenService } from '../../src/services/api-token.service';

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

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe.each(databases)('hash API tokens migration on %s', (_name, options) => {
  it('hashes stored plain tokens in place, so issued tokens keep working', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'tokhash_mig_test_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata(ApiToken).tablePath;
    const repo = source.getRepository(ApiToken);
    try {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.createTable(Table.create(source.getMetadata(ApiToken), source.driver));

      // Rows as an earlier release wrote them: the plain token in `token`.
      const plainA = 'a1'.repeat(40);
      const plainB = 'b2'.repeat(40);
      const plainLegacy = 'host-issued-token';
      const a = await repo.save(
        repo.create({ name: 'A', token: plainA, userId: 1, abilities: ['*'] }),
      );
      const b = await repo.save(
        repo.create({ name: 'B', token: plainB, userId: 2, abilities: ['agent'], isActive: false }),
      );
      const legacy = await repo.save(
        repo.create({ name: 'Legacy', token: plainLegacy, userId: 3, abilities: ['admin'] }),
      );
      // A token issued by this release is already a digest and must not be hashed twice.
      const plainNew = 'c3'.repeat(40);
      const fresh = await repo.save(
        repo.create({ name: 'Fresh', token: sha256(plainNew), userId: 4, abilities: ['*'] }),
      );

      const migration = new HashApiTokens1793145600000();
      await migration.up(runner);

      const byId = async (id: number) => (await repo.findOneByOrFail({ id })).token;
      expect(await byId(a.id)).toBe(sha256(plainA));
      expect(await byId(b.id)).toBe(sha256(plainB));
      expect(await byId(legacy.id)).toBe(sha256(plainLegacy));
      expect(await byId(fresh.id)).toBe(sha256(plainNew));

      // Running it again changes nothing.
      await migration.up(runner);
      expect(await byId(a.id)).toBe(sha256(plainA));

      // Everything else on the rows is untouched.
      const after = await repo.findOneByOrFail({ id: b.id });
      expect(after).toMatchObject({ name: 'B', abilities: ['agent'], isActive: false });

      // The clients' existing plain tokens still authenticate.
      const service = new ApiTokenService(repo);
      expect((await service.validate(plainA))?.id).toBe(a.id);
      expect((await service.validate(plainLegacy, 'admin'))?.id).toBe(legacy.id);
      expect((await service.validate(plainNew))?.id).toBe(fresh.id);
      expect(await service.validate(plainB)).toBeNull(); // still revoked

      // Digests cannot be reversed; down() leaves them in place.
      await migration.down(runner);
      expect(await byId(a.id)).toBe(sha256(plainA));
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
