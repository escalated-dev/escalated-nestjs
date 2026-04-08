import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('escalated_api_tokens')
export class ApiToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, unique: true })
  token: string;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'simple-json', nullable: true })
  abilities: string[]; // ['tickets:read', 'tickets:write', ...]

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
