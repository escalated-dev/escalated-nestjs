import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { NewsletterListMember } from './newsletter-list-member.entity';

@Entity('escalated_newsletter_lists')
export class NewsletterList {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  kind: 'static' | 'dynamic';

  @Column({ type: 'simple-json', nullable: true })
  filter_json: { rules: Array<{ field: string; op: string; value: unknown }> } | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => NewsletterListMember, (m) => m.list)
  members: NewsletterListMember[];
}
