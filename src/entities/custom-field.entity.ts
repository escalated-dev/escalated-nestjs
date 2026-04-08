import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('escalated_custom_fields')
export class CustomField {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255 })
  slug: string;

  @Column({ length: 50 })
  fieldType: string; // text, textarea, number, select, multiselect, checkbox, date

  @Column({ type: 'simple-json', nullable: true })
  options: string[]; // for select/multiselect

  @Column({ default: false })
  isRequired: boolean;

  @Column({ length: 100, default: 'ticket' })
  entityType: string; // ticket, agent, customer

  @Column({ type: 'text', nullable: true })
  defaultValue: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
