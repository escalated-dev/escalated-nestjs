import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CustomField } from './custom-field.entity';

@Entity('escalated_custom_field_values')
@Index(['entityType', 'entityId', 'customFieldId'], { unique: true })
export class CustomFieldValue {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CustomField, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customFieldId' })
  customField: CustomField;

  @Column()
  customFieldId: number;

  @Column({ length: 100 })
  entityType: string;

  @Column({ type: 'int' })
  entityId: number;

  @Column({ type: 'text', nullable: true })
  value: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
