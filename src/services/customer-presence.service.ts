import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, LessThanOrEqual, Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import { AgentProfile } from '../entities/agent-profile.entity';
import { CustomerPresence } from '../entities/customer-presence.entity';

export const PRESENCE_THROTTLE_SECONDS = 30;
export const DEFAULT_ONLINE_WINDOW_SECONDS = 120;

type Subject = [type: 'user' | 'contact' | 'ticket', id: string];

interface TicketCustomer {
  id?: number;
  requesterId?: UserId | null;
  contactId?: number | null;
}

/**
 * Customer online status (ADR 2026-11-05-agent-panel-data, section 2).
 *
 * Requests the customer already makes (the customer portal, widget chat, the
 * widget's ticket lookup) record when they were last seen, at most once per
 * customer every 30 seconds. A customer is online while that is within
 * `presence.onlineWindowSeconds` (default 120). Only staff pages read it.
 */
@Injectable()
export class CustomerPresenceService {
  constructor(
    @InjectRepository(CustomerPresence) private readonly rows: Repository<CustomerPresence>,
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  /** The one host user every guest ticket names under the `guest_user` policy. */
  private sharedGuestUser(): UserId | null {
    const policy = this.options?.guestPolicy as { mode?: string; guestUserId?: UserId } | undefined;
    return policy?.mode === 'guest_user' ? (policy.guestUserId ?? null) : null;
  }

  window(): number {
    const seconds = Number(this.options?.presence?.onlineWindowSeconds);
    return Number.isFinite(seconds) && seconds >= 1
      ? Math.floor(seconds)
      : DEFAULT_ONLINE_WINDOW_SECONDS;
  }

  /** A signed-in customer-portal user. Staff browsing the portal are not customers. */
  async seeUser(userId: UserId): Promise<void> {
    if (userId == null || String(userId) === '' || String(userId) === '0') return;
    if (await this.profiles.exists({ where: { userId } })) return;
    await this.see(['user', String(userId)]);
  }

  /** The customer of a ticket the widget just served. */
  async seeTicketCustomer(ticket: TicketCustomer | null | undefined): Promise<void> {
    const subject = ticket ? subjectOf(ticket, this.sharedGuestUser()) : null;
    if (subject) await this.see(subject);
  }

  /** The same, never failing the request it rides on. */
  async quietly(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch {
      // Presence is a hint; it never breaks the customer's request.
    }
  }

  /**
   * `requester_online` and `requester_last_seen_at` for each ticket, from one
   * query. For staff pages only.
   */
  async lookup(
    tickets: Array<TicketCustomer & { id: number }>,
  ): Promise<Map<number, { requester_online: boolean; requester_last_seen_at: string | null }>> {
    const subjects = new Map<string, Subject>();
    for (const ticket of tickets) {
      const subject = subjectOf(ticket, this.sharedGuestUser());
      if (subject) subjects.set(subject.join('|'), subject);
    }
    const seen = new Map<string, Date>();
    if (subjects.size) {
      const query = this.rows.createQueryBuilder('presence').where(
        new Brackets((q) => {
          let i = 0;
          for (const [type, id] of subjects.values()) {
            i += 1;
            q.orWhere(`(presence.subjectType = :type${i} AND presence.subjectId = :id${i})`, {
              [`type${i}`]: type,
              [`id${i}`]: id,
            });
          }
        }),
      );
      for (const row of await query.getMany()) {
        seen.set(`${row.subjectType}|${row.subjectId}`, new Date(row.lastSeenAt));
      }
    }
    const since = Date.now() - this.window() * 1000;
    const result = new Map<
      number,
      { requester_online: boolean; requester_last_seen_at: string | null }
    >();
    for (const ticket of tickets) {
      const subject = subjectOf(ticket, this.sharedGuestUser());
      const last = subject ? seen.get(subject.join('|')) : undefined;
      result.set(ticket.id, {
        requester_online: !!last && last.getTime() >= since,
        requester_last_seen_at: last ? last.toISOString() : null,
      });
    }
    return result;
  }

  private async see([type, id]: Subject): Promise<void> {
    const now = Date.now();
    const at = new Date(now);
    // Throttled in the database, so it holds across processes: the row is
    // only written when its last write is 30 seconds old.
    const updated = await this.rows.update(
      {
        subjectType: type,
        subjectId: id,
        lastSeenAt: LessThanOrEqual(new Date(now - PRESENCE_THROTTLE_SECONDS * 1000)),
      },
      { lastSeenAt: at },
    );
    if (updated.affected) return;
    if (await this.rows.exists({ where: { subjectType: type, subjectId: id } })) return;
    try {
      await this.rows.insert({ subjectType: type, subjectId: id, lastSeenAt: at });
    } catch {
      // Another request created the row first.
    }
  }
}

/**
 * A ticket's customer: its requester, or its contact for a guest ticket, or,
 * for a guest with neither (a widget chat), the ticket itself.
 */
export function subjectOf(
  ticket: TicketCustomer,
  sharedGuestUser: UserId | null = null,
): Subject | null {
  const requester = ticket.requesterId;
  const shared = sharedGuestUser != null && String(requester) === String(sharedGuestUser);
  if (requester != null && String(requester) !== '' && String(requester) !== '0' && !shared) {
    return ['user', String(requester)];
  }
  if (ticket.contactId != null) return ['contact', String(ticket.contactId)];
  // A guest known by nothing but the ticket (a widget chat visitor).
  if (ticket.id != null) return ['ticket', String(ticket.id)];
  return null;
}
