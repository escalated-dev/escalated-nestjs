import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { userIdColumn, UserId } from '../config/user-id-column';

/**
 * A staff user's TOTP enrolment (escalated-laravel's `escalated_two_factor`).
 * The secret and the recovery codes are sealed (AES-256-GCM) and never sent
 * to a page. Confirmed once the user has entered a first code.
 */
@Entity('escalated_two_factor')
export class TwoFactor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column(userIdColumn({ unique: true }))
  userId: UserId;

  /** The base32 TOTP secret, sealed. */
  @Column({ type: 'text' })
  secret: string;

  /** The unused recovery codes, as a sealed JSON list. */
  @Column({ type: 'text', nullable: true })
  recoveryCodes: string | null;

  @Column({ type: Date, nullable: true })
  confirmedAt: Date | null;

  /** The TOTP time step last accepted; that step and earlier ones are refused. */
  @Column({ type: 'int', nullable: true })
  lastUsedStep: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
