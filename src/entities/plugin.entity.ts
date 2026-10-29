import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A plugin's activation state, one row per plugin that has ever been
 * activated (escalated-laravel's `escalated_plugins`). A registered plugin
 * with no row is inactive.
 */
@Entity('escalated_plugins')
export class EscalatedPlugin {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  slug: string;

  @Index()
  @Column({ default: false })
  isActive: boolean;

  @Column({ type: Date, nullable: true })
  activatedAt: Date | null;

  @Column({ type: Date, nullable: true })
  deactivatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
