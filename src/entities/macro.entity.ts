import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('escalated_macros')
export class Macro {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // Actions: [{type: 'set_status', value: 2}, {type: 'set_priority', value: 'high'}, {type: 'add_reply', value: '...'}, ...]
  @Column({ type: 'simple-json' })
  actions: Record<string, any>[];

  @Column({ length: 50, default: 'shared' })
  scope: string; // shared, personal

  @Column({ type: 'int', nullable: true })
  createdBy: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
