import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A Contact is the first-class identity for a ticket requester that does NOT
 * necessarily map to a host-app user account.
 *
 * Public ticket submissions (widget form, inbound email) create a Contact by
 * email. If/when the guest later creates a host-app account, the Contact is
 * linked via `userId` and all prior tickets are back-stamped with the new
 * `requesterId` (see ContactService.promoteToUser).
 */
@Entity('escalated_contacts')
@Index(['email'], { unique: true })
export class Contact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 320 })
  email: string;

  @Column({ length: 255, nullable: true, type: 'varchar' })
  name: string | null;

  /** Links this contact to a host-app user once they create an account. */
  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ type: 'simple-json', default: '{}' })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
