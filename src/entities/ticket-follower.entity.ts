import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Join row between a Ticket and a host-app user that's "following" it —
 * receives notifications on every reply / status change without being
 * the assignee or requester.
 *
 * Populated via:
 *   - The {@code add_follower} workflow action.
 *   - A future manual "Follow" button (Task 7.8 / plan Phase 7).
 *
 * Unique on {@code (ticketId, userId)} so a user can't double-follow
 * a ticket.
 */
@Entity('escalated_ticket_followers')
@Index(['ticketId', 'userId'], { unique: true })
@Index(['userId'])
export class TicketFollower {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  @Column({ type: 'int' })
  userId: number;

  @CreateDateColumn()
  createdAt: Date;
}
