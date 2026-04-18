import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { KbCategory } from './kb-category.entity';

@Entity('escalated_kb_articles')
export class KbArticle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 500 })
  title: string;

  @Column({ length: 500, unique: true })
  slug: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  excerpt: string;

  @ManyToOne(() => KbCategory, (c) => c.articles, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category: KbCategory;

  @Column({ type: 'int', nullable: true })
  categoryId: number;

  @Column({ type: 'int', nullable: true })
  authorId: number;

  @Column({ length: 20, default: 'draft' })
  status: string; // draft, published, archived

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @Column({ type: 'int', default: 0 })
  helpfulCount: number;

  @Column({ type: 'int', default: 0 })
  notHelpfulCount: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
