import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { CustomObjectRecord } from './custom-object-record.entity';

/** One field of a custom object's schema. */
export interface CustomObjectFieldDefinition {
  name: string;
  type: 'text' | 'number' | 'select' | 'date' | 'lookup';
  required?: boolean;
  options?: string[];
}

/** A custom object type and the schema its records follow (escalated-laravel's CustomObject). */
@Entity('escalated_custom_objects')
export class CustomObject {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Index({ unique: true })
  @Column({ length: 100 })
  slug: string;

  @Column({ type: 'simple-json' })
  fieldsSchema: CustomObjectFieldDefinition[];

  @OneToMany(() => CustomObjectRecord, (record) => record.object)
  records: CustomObjectRecord[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
