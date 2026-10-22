import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CustomObject } from './custom-object.entity';

/** A record of a custom object; `data` follows the object's schema (escalated-laravel's CustomObjectRecord). */
@Entity('escalated_custom_object_records')
export class CustomObjectRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CustomObject, (object) => object.records, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'objectId' })
  object: CustomObject;

  @Index()
  @Column()
  objectId: number;

  @Column({ type: 'simple-json' })
  data: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
