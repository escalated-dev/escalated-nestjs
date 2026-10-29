import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * The plugin tables, as escalated-laravel has them (domain-model/plugin-contract.md):
 * `escalated_plugins`, one activation row per plugin slug, and
 * `escalated_plugin_store`, where `ctx.store` and `ctx.config` keep a plugin's
 * data under its name. Register with the host DataSource and run before
 * upgrading.
 */
export class Plugins1793318400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const { plugin, store, column, index } = this.names(runner);
    const timestamp = this.timestamp(runner);
    const id = (meta: typeof plugin) => ({
      name: column(meta, 'id'),
      type: 'integer',
      isPrimary: true,
      isGenerated: true,
      generationStrategy: 'increment' as const,
    });

    await runner.createTable(
      new Table({
        name: plugin.tablePath,
        columns: [
          id(plugin),
          { name: column(plugin, 'slug'), type: 'varchar', length: '255' },
          { name: column(plugin, 'isActive'), type: 'boolean', default: false },
          { name: column(plugin, 'activatedAt'), type: timestamp, isNullable: true },
          { name: column(plugin, 'deactivatedAt'), type: timestamp, isNullable: true },
          { name: column(plugin, 'createdAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
          { name: column(plugin, 'updatedAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
        ],
        indices: [
          { name: index.slug, columnNames: [column(plugin, 'slug')], isUnique: true },
          { name: index.active, columnNames: [column(plugin, 'isActive')] },
        ],
      }),
    );

    await runner.createTable(
      new Table({
        name: store.tablePath,
        columns: [
          id(store),
          { name: column(store, 'plugin'), type: 'varchar', length: '191' },
          { name: column(store, 'collection'), type: 'varchar', length: '100' },
          { name: column(store, 'key'), type: 'varchar', length: '191', isNullable: true },
          { name: column(store, 'data'), type: 'text', isNullable: true },
          { name: column(store, 'createdAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
          { name: column(store, 'updatedAt'), type: timestamp, default: 'CURRENT_TIMESTAMP' },
        ],
        indices: [
          {
            name: index.lookup,
            columnNames: [
              column(store, 'plugin'),
              column(store, 'collection'),
              column(store, 'key'),
            ],
          },
        ],
      }),
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const { plugin, store } = this.names(runner);
    await runner.dropTable(store.tablePath, true, true, true);
    await runner.dropTable(plugin.tablePath, true, true, true);
  }

  private timestamp(runner: QueryRunner): string {
    return runner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
  }

  private names(runner: QueryRunner) {
    const plugin = runner.connection.getMetadata('EscalatedPlugin');
    const store = runner.connection.getMetadata('PluginStoreRecord');
    const column = (meta: typeof plugin, property: string) =>
      meta.findColumnWithPropertyName(property)?.databaseName ?? property;
    const on = (meta: typeof plugin, property: string, unique: boolean) =>
      meta.indices.find(
        (i) => i.isUnique === unique && i.columns.some((c) => c.propertyName === property),
      )?.name;
    return {
      plugin,
      store,
      column,
      index: {
        slug: on(plugin, 'slug', true) ?? `IDX_${plugin.tableName}_slug`.slice(0, 63),
        active: on(plugin, 'isActive', false) ?? `IDX_${plugin.tableName}_active`.slice(0, 63),
        lookup: on(store, 'plugin', false) ?? `IDX_${store.tableName}_lookup`.slice(0, 63),
      },
    };
  }
}
