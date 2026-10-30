import { DataSource, DataSourceOptions } from 'typeorm';
import { SsoMessageId } from '../../src/entities';
import { SsoMessageIds1793577600000 } from '../../src/migrations/1793577600000-SsoMessageIds';
import { SsoMessageIdsService } from '../../src/services/sso-message-ids.service';

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

describe.each(databases)('SSO message IDs migration on %s', (_name, options) => {
  it('creates the table, keeps each ID once per kind, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: [SsoMessageId],
      entityPrefix: 'sso_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const table = source.getMetadata(SsoMessageId).tablePath;
    const migration = new SsoMessageIds1793577600000();
    try {
      await migration.up(runner);
      const ids = new SsoMessageIdsService(source.getRepository(SsoMessageId));
      const later = Math.floor(Date.now() / 1000) + 600;

      // An issued request is answered once.
      await ids.remember('saml_request', '_req1', later);
      expect(await ids.consume('saml_request', '_req1')).toBe(true);
      expect(await ids.consume('saml_request', '_req1')).toBe(false);
      // An expired one is not answerable.
      await ids.remember('saml_request', '_old', Math.floor(Date.now() / 1000) - 1);
      expect(await ids.consume('saml_request', '_old')).toBe(false);

      // An accepted ID is refused the second time, per kind.
      expect(await ids.claim('jwt', 'jti-1', later)).toBe(true);
      expect(await ids.claim('jwt', 'jti-1', later)).toBe(false);
      expect(await ids.claim('saml_assertion', 'jti-1', later)).toBe(true);
      // Far-future expiries fit (Unix seconds beyond 2038).
      expect(await ids.claim('jwt', 'jti-2', 4_102_444_800)).toBe(true);
      expect(
        (await source.getRepository(SsoMessageId).findOneByOrFail({ messageId: 'jti-2' }))
          .expiresAt,
      ).toBe(4_102_444_800);

      await migration.down(runner);
      expect(await runner.hasTable(table)).toBe(false);
    } finally {
      if (await runner.hasTable(table)) await runner.dropTable(table);
      await runner.release();
      await source.destroy();
    }
  });
});
