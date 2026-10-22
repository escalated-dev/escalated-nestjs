import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { userIdColumn, UserId } from '../config/user-id-column';

@Entity('escalated_api_tokens')
export class ApiToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  /** Looked up by the token guard; never serialized. Shown once, on creation. */
  @Column({ length: 255, unique: true })
  token: string;

  @Column(userIdColumn())
  userId: UserId;

  @Column({ type: 'simple-json', nullable: true })
  abilities: string[]; // ['tickets:read', 'tickets:write', ...]

  @Column({ type: Date, nullable: true })
  lastUsedAt: Date;

  @Column({ type: Date, nullable: true })
  expiresAt: Date;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  toJSON() {
    const { token: _token, ...rest } = this;
    return rest;
  }
}
