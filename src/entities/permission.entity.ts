import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('escalated_permissions')
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100, nullable: true })
  group: string; // tickets, agents, admin, etc.

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}
