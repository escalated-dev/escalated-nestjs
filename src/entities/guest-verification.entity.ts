import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A one-time code emailed to a guest to prove they can read a mailbox (see
 * docs/guest-access.md). Neither the code nor the address is stored: both are
 * keyed digests.
 */
@Entity('escalated_guest_verifications')
export class GuestVerification {
  /** A random UUID, sent to the guest as `verification_id`. */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  emailDigest: string;

  /** `ticket`, `chat` or `lookup`. */
  @Column({ type: 'varchar', length: 20 })
  purpose: string;

  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Index()
  @Column({ type: Date })
  expiresAt: Date;

  @Column({ type: Date, nullable: true })
  usedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
