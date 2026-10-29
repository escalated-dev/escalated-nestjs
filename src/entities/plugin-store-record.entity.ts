import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * What a plugin keeps through `ctx.store` and `ctx.config`
 * (escalated-laravel's `escalated_plugin_store`), keyed by the plugin's
 * name. Config is the row with collection and key `__config__`.
 */
@Entity('escalated_plugin_store')
@Index(['plugin', 'collection', 'key'])
export class PluginStoreRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 191 })
  plugin: string;

  @Column({ type: 'varchar', length: 100 })
  collection: string;

  @Column({ type: 'varchar', length: 191, nullable: true })
  key: string | null;

  @Column({ type: 'simple-json', nullable: true })
  data: unknown;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
