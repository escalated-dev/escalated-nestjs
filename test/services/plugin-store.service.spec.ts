import { DataSource } from 'typeorm';
import { PluginStoreRecord } from '../../src/entities';
import { PluginStoreService } from '../../src/plugins/plugin-store.service';

/**
 * `ctx.store` and `ctx.config` over a real SQLite table, with the query
 * operators of escalated-laravel's ContextHandler.
 */
describe('PluginStoreService', () => {
  let source: DataSource;
  let store: PluginStoreService;
  const CRM = '@acme/crm';

  beforeAll(async () => {
    source = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [PluginStoreRecord],
      synchronize: true,
    });
    await source.initialize();
    store = new PluginStoreService(source.getRepository(PluginStoreRecord));

    for (const deal of [
      { key: 'd1', name: 'Alpha', amount: 10, stage: 'won', tags: ['vip', 'eu'], owner: { id: 1 } },
      { key: 'd2', name: 'Beta', amount: 9, stage: 'lost', tags: ['eu'], owner: { id: 2 } },
      { key: 'd3', name: 'Gamma', amount: 25, stage: 'open', tags: [], owner: { id: 1 } },
      { key: 'd4', name: 'Delta', amount: 'n/a', stage: 'open', tags: ['us'], owner: { id: 3 } },
    ]) {
      await store.insert(CRM, 'deals', deal);
    }
    await store.insert('@other/plugin', 'deals', { key: 'x1', name: 'Theirs', amount: 99 });
  });

  afterAll(() => source.destroy());

  const names = (rows: Record<string, unknown>[]) => rows.map((row) => row.name);

  it('inserts with the key from data and returns the row with its _id', async () => {
    const row = await store.insert(CRM, 'notes', { key: 'n1', text: 'hi' });
    expect(row).toEqual({ _id: expect.any(Number), key: 'n1', text: 'hi' });
    expect(await store.get(CRM, 'notes', 'n1')).toEqual({ key: 'n1', text: 'hi' });
  });

  it('matches equality, and an array field containing the value', async () => {
    expect(names(await store.query(CRM, 'deals', { stage: 'open' }))).toEqual(['Gamma', 'Delta']);
    expect(names(await store.query(CRM, 'deals', { tags: 'eu' }))).toEqual(['Alpha', 'Beta']);
    expect(names(await store.query(CRM, 'deals', { 'owner.id': 1 }))).toEqual(['Alpha', 'Gamma']);
  });

  it('applies the comparison and set operators', async () => {
    expect(names(await store.query(CRM, 'deals', { amount: { $gt: 9 } }))).toEqual([
      'Alpha',
      'Gamma',
    ]);
    expect(names(await store.query(CRM, 'deals', { amount: { $gte: 10, $lt: 25 } }))).toEqual([
      'Alpha',
    ]);
    expect(names(await store.query(CRM, 'deals', { amount: { $lte: 9 } }))).toEqual(['Beta']);
    expect(names(await store.query(CRM, 'deals', { stage: { $ne: 'open' } }))).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(names(await store.query(CRM, 'deals', { stage: { $in: ['won', 'lost'] } }))).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(names(await store.query(CRM, 'deals', { stage: { $nin: ['won', 'lost'] } }))).toEqual([
      'Gamma',
      'Delta',
    ]);
  });

  it('orders numbers by value, then strings, and limits', async () => {
    expect(names(await store.query(CRM, 'deals', {}, { orderBy: 'amount' }))).toEqual([
      'Beta',
      'Alpha',
      'Gamma',
      'Delta',
    ]);
    expect(
      names(await store.query(CRM, 'deals', {}, { orderBy: 'amount', order: 'desc', limit: 2 })),
    ).toEqual(['Delta', 'Gamma']);
  });

  it('refuses a field name that is anything but a dotted path, and unknown operators', async () => {
    await expect(store.query(CRM, 'deals', { "name') OR 1=1 --": 'x' })).rejects.toThrow(
      'Invalid store field name',
    );
    await expect(store.query(CRM, 'deals', {}, { orderBy: 'amount desc' })).rejects.toThrow(
      'Invalid store field name',
    );
    await expect(store.query(CRM, 'deals', { amount: { $where: '1' } })).rejects.toThrow(
      'Unsupported store operator',
    );
  });

  it("never reads or writes another plugin's rows", async () => {
    expect(names(await store.query(CRM, 'deals', { name: 'Theirs' }))).toEqual([]);
    expect(await store.get(CRM, 'deals', 'x1')).toBeNull();
    await expect(store.update(CRM, 'deals', 'x1', { name: 'Mine' })).rejects.toThrow();
    await store.delete(CRM, 'deals', 'x1');
    expect(await store.get('@other/plugin', 'deals', 'x1')).toMatchObject({ name: 'Theirs' });
  });

  it('updates by merging, sets by replacing, and deletes by key', async () => {
    expect(await store.update(CRM, 'deals', 'd3', { stage: 'won' })).toMatchObject({
      name: 'Gamma',
      stage: 'won',
    });
    await store.set(CRM, 'flags', 'beta', { on: true });
    await store.set(CRM, 'flags', 'beta', { on: false });
    expect(await store.get(CRM, 'flags', 'beta')).toEqual({ on: false });
    await store.delete(CRM, 'flags', 'beta');
    expect(await store.get(CRM, 'flags', 'beta')).toBeNull();
  });

  it('keeps config in one row per plugin, merging each set', async () => {
    await store.configSet(CRM, { api_key: 'k', region: 'eu' });
    await store.configSet(CRM, { region: 'us' });
    expect(await store.configAll(CRM)).toEqual({ api_key: 'k', region: 'us' });
    expect(await store.configGet(CRM, 'missing')).toBeNull();
    expect(await store.configAll('@other/plugin')).toEqual({});
    expect(
      await source
        .getRepository(PluginStoreRecord)
        .count({ where: { plugin: CRM, collection: '__config__', key: '__config__' } }),
    ).toBe(1);
  });
});
