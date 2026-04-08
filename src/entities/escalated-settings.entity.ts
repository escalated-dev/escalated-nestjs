import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('escalated_settings')
export class EscalatedSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255, unique: true })
  key: string;

  @Column({ type: 'text', nullable: true })
  value: string;

  @Column({ length: 50, default: 'string' })
  type: string; // string, boolean, number, json

  @Column({ length: 100, default: 'general' })
  group: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
