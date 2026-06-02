import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('escalated_newsletter_templates')
export class NewsletterTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Index()
  @Column({ length: 64, default: 'default' })
  theme: string;

  @Column({ length: 998, nullable: true })
  subject_template: string | null;

  @Column({ type: 'text' })
  body_markdown: string;

  @Column({ type: 'simple-json', nullable: true })
  merge_fields_schema: unknown | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
