import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A custom field definition, as escalated-laravel's CustomField. The columns
 * keep this package's names; the admin screens and ticket payloads serialise
 * them with Laravel's keys (`type`, `context`, `required`, `position`,
 * `active`, see `serializeCustomField`).
 */
@Entity('escalated_custom_fields')
export class CustomField {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255 })
  slug: string;

  /** text, textarea, select, multi_select, checkbox, date, number (`multiselect` is read as multi_select). */
  @Column({ length: 50 })
  fieldType: string;

  @Column({ type: 'simple-json', nullable: true })
  options: string[]; // for select/multi_select

  @Column({ default: false })
  isRequired: boolean;

  /** Laravel's `context`: ticket, user or organization (older rows: agent, customer). */
  @Column({ length: 100, default: 'ticket' })
  entityType: string;

  @Column({ type: 'text', nullable: true })
  defaultValue: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  placeholder: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'simple-json', nullable: true })
  validationRules: unknown;

  @Column({ type: 'simple-json', nullable: true })
  conditions: unknown;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
