import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Which Escalated record a source record became, per import job. A record
 * already mapped is skipped, which is what makes an import resumable; later
 * entity types resolve their references (a reply's ticket) through it.
 */
@Entity('escalated_import_source_maps')
@Index(['importJobId', 'entityType', 'sourceId'], { unique: true })
export class ImportSourceMap {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 36 })
  importJobId: string;

  @Column({ type: 'varchar', length: 50 })
  entityType: string;

  @Column({ type: 'varchar', length: 191 })
  sourceId: string;

  @Column({ type: 'varchar', length: 191 })
  escalatedId: string;

  @CreateDateColumn()
  createdAt: Date;
}
