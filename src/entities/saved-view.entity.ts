import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('escalated_saved_views')
export class SavedView {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'int', nullable: true })
  userId: number; // null = shared view

  @Column({ type: 'simple-json' })
  filters: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  columns: string[];

  @Column({ length: 100, nullable: true })
  sortBy: string;

  @Column({ length: 10, default: 'desc' })
  sortDirection: string;

  @Column({ default: false })
  isDefault: boolean;

  @Column({ default: false })
  isShared: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
