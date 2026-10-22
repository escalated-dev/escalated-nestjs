import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { StatusCategory, statusCategory } from './status-category';

/**
 * A ticket status. Each belongs to a category (`new`, `open`, `pending`,
 * `on_hold`, `solved`) and ticket lifecycle keys off the category; see
 * `status-category.ts`. `isClosed` is kept equal to `category === 'solved'`
 * for code and data written before categories existed.
 */
@Entity('escalated_ticket_statuses')
export class TicketStatus {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 50 })
  slug: string;

  @Column({ length: 20, default: '#6b7280' })
  color: string;

  /** One of `STATUS_CATEGORIES`; empty on rows that predate it (inferred). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  category: StatusCategory | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ default: false })
  isDefault: boolean;

  /** A built-in status: its slug and category are fixed and it cannot be deleted. */
  @Column({ default: false })
  isSystem: boolean;

  /** `category === 'solved'`, kept in step with the category. */
  @Column({ default: false })
  isClosed: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  syncCategory(): void {
    this.category = statusCategory(this);
    this.isClosed = this.category === 'solved';
  }
}
