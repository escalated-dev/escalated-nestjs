import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource, DataSourceOptions, getMetadataArgsStorage } from 'typeorm';

jest.setTimeout(120000);

/**
 * The README promises PostgreSQL, MySQL and SQLite, so every entity's column
 * types must be accepted by all three drivers.
 *
 * - Metadata is built for every entity on each driver. That runs TypeORM's
 *   column type validation and needs no database server.
 * - SQLite runs a real `synchronize` plus a date round trip over the entities a
 *   default install registers (newsletters are opt-in and registered only when
 *   enabled).
 * - PostgreSQL does the same over every entity, newsletters included, when
 *   ESCALATED_TEST_POSTGRES_URL points at a throwaway database (it is wiped via
 *   `dropSchema`), e.g. postgres://postgres:postgres@localhost:5432/escalated_test.
 */

type EntityClass = new (...args: never[]) => object;

async function entitiesDeclaredIn(dir: string): Promise<EntityClass[]> {
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.entity.ts')) {
      await import(join(dir, file));
    }
  }
  const targets = getMetadataArgsStorage().tables.map((table) => table.target);
  return [...new Set(targets.filter((t): t is EntityClass => typeof t === 'function'))];
}

// Whole seconds, so no driver's fractional-second precision matters.
const LAST_RUN_AT = new Date('2026-09-13T12:34:56.000Z');
const EXPIRES_AT = new Date('2027-01-02T03:04:05.000Z');

async function synchronizeAndRoundTripDates(
  options: DataSourceOptions,
  entities: EntityClass[],
): Promise<void> {
  const dataSource = new DataSource({
    ...options,
    entities,
    synchronize: true,
  } as DataSourceOptions);
  await dataSource.initialize();
  try {
    // Automation.lastRunAt was declared 'datetime' (rejected by PostgreSQL).
    const automations = dataSource.getRepository('Automation');
    const automation = await automations.save({
      name: 'Close stale tickets',
      conditions: [],
      actions: [],
      lastRunAt: LAST_RUN_AT,
    });
    const storedAutomation: any = await automations.findOneByOrFail({ id: automation.id });
    expect(new Date(storedAutomation.lastRunAt).getTime()).toBe(LAST_RUN_AT.getTime());

    // ApiToken.expiresAt was declared 'timestamp' (rejected by SQLite).
    const tokens = dataSource.getRepository('ApiToken');
    const token = await tokens.save({
      name: 'CI',
      token: 'tok_portable',
      userId: 1,
      expiresAt: EXPIRES_AT,
    });
    const storedToken: any = await tokens.findOneByOrFail({ id: token.id });
    expect(new Date(storedToken.expiresAt).getTime()).toBe(EXPIRES_AT.getTime());
  } finally {
    await dataSource.destroy();
  }
}

describe('entity schema portability', () => {
  let coreEntities: EntityClass[];
  let allEntities: EntityClass[];

  beforeAll(async () => {
    // Core first, so the snapshot excludes the newsletter entities loaded next.
    coreEntities = await entitiesDeclaredIn(join(__dirname, '../../src/entities'));
    allEntities = await entitiesDeclaredIn(join(__dirname, '../../src/entities/newsletter'));
  });

  it('discovers the core and newsletter entities', () => {
    const core = coreEntities.map((e) => e.name);
    const all = allEntities.map((e) => e.name);

    expect(core).toEqual(expect.arrayContaining(['Ticket', 'Automation', 'Contact', 'ApiToken']));
    expect(core).not.toContain('Newsletter');
    expect(all).toEqual(expect.arrayContaining(['Newsletter', 'NewsletterDelivery']));
  });

  it.each([
    ['postgres', { type: 'postgres', host: 'localhost', database: 'unused' }],
    ['mysql', { type: 'mysql', host: 'localhost', database: 'unused' }],
    ['better-sqlite3', { type: 'better-sqlite3', database: ':memory:' }],
  ])('accepts every entity column type on %s', async (_name, options) => {
    const dataSource = new DataSource({ ...options, entities: allEntities } as DataSourceOptions);

    // No connection is opened; this is TypeORM's metadata build and validation.
    await expect((dataSource as any).buildMetadatas()).resolves.not.toThrow();
  });

  it('synchronizes a default install and round-trips dates on SQLite', async () => {
    await synchronizeAndRoundTripDates(
      { type: 'better-sqlite3', database: ':memory:' },
      coreEntities,
    );
  });

  const postgresUrl = process.env.ESCALATED_TEST_POSTGRES_URL;
  (postgresUrl ? it : it.skip)(
    'synchronizes every entity and round-trips dates on PostgreSQL',
    async () => {
      await synchronizeAndRoundTripDates(
        { type: 'postgres', url: postgresUrl, dropSchema: true },
        allEntities,
      );
    },
  );
});
