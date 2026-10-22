import { DataSource, DataSourceOptions } from 'typeorm';
import * as entities from '../../src/entities';
import { ImportJobs1793059200000 } from '../../src/migrations/1793059200000-ImportJobs';

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

describe.each(databases)('import jobs migration on %s', (_name, options) => {
  it('creates the job and source map tables, and rolls back', async () => {
    const source = new DataSource({
      ...options,
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      entityPrefix: 'imp_mig_',
    } as DataSourceOptions);
    await source.initialize();
    const runner = source.createQueryRunner();
    const jobTable = source.getMetadata('ImportJob').tablePath;
    const mapTable = source.getMetadata('ImportSourceMap').tablePath;
    const migration = new ImportJobs1793059200000();
    try {
      await migration.up(runner);

      // The tables take rows through the entities.
      const jobs = source.getRepository('ImportJob');
      const job = await jobs.save(
        jobs.create({
          platform: 'fake',
          status: 'mapping',
          userId: 1,
          fieldMappings: { tickets: { subject: 'title' } },
          progress: { tickets: { processed: 2, cursor: 'p2' } },
          errorLog: [],
        }),
      );
      const [stored] = await source.getRepository('ImportJob').find();
      expect(stored).toMatchObject({
        id: job.id,
        platform: 'fake',
        status: 'mapping',
        credentials: null,
        fieldMappings: { tickets: { subject: 'title' } },
        progress: { tickets: { processed: 2, cursor: 'p2' } },
        startedAt: null,
      });
      const maps = source.getRepository('ImportSourceMap');
      await maps.insert({
        importJobId: job.id,
        entityType: 'tickets',
        sourceId: 't1',
        escalatedId: '7',
      });

      // A source record maps once per job and type.
      await expect(
        maps.insert({
          importJobId: job.id,
          entityType: 'tickets',
          sourceId: 't1',
          escalatedId: '8',
        }),
      ).rejects.toThrow();
      await maps.insert({
        importJobId: job.id,
        entityType: 'replies',
        sourceId: 't1',
        escalatedId: '9',
      });

      await migration.down(runner);
      expect(await runner.hasTable(mapTable)).toBe(false);
      expect(await runner.hasTable(jobTable)).toBe(false);
    } finally {
      for (const table of [mapTable, jobTable]) {
        if (await runner.hasTable(table)) await runner.dropTable(table);
      }
      await runner.release();
      await source.destroy();
    }
  });
});
