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

  /**
   * The SHA-256 hex digest of the token (see `hashApiToken`); the plain token
   * is returned once, on creation, and never stored. Never serialized.
   */
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
