import { Repository } from 'typeorm';
import { TicketFollower } from '../entities/ticket-follower.entity';
import { UserId } from '../config/user-id-column';

/**
 * Resolve the host-user ids following a ticket, excluding the actor (a user is
 * never notified of their own action) and de-duplicated.
 *
 * The package abstracts the host user table and cannot resolve follower emails
 * itself, so these ids ride along on the domain events (reply-created /
 * status-changed) for the host app to fan a notification out to. See issue #74.
 */
export async function resolveFollowerUserIds(
  followerRepo: Repository<TicketFollower>,
  ticketId: number,
  actorUserId: UserId,
): Promise<UserId[]> {
  const rows = await followerRepo.find({ where: { ticketId }, select: ['userId'] });
  const result: UserId[] = [];
  const seen = new Set<UserId>();
  for (const row of rows) {
    if (row.userId === actorUserId || seen.has(row.userId)) continue;
    seen.add(row.userId);
    result.push(row.userId);
  }
  return result;
}
