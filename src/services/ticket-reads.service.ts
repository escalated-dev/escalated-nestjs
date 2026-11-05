import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import type { UserId } from '../config/user-id-column';
import { Ticket } from '../entities/ticket.entity';
import { TicketRead } from '../entities/ticket-read.entity';

/**
 * Per-agent unread tracking (ADR 2026-11-05-agent-panel-data, section 1).
 *
 * A ticket is unread for an agent when the agent marked it unread, or when it
 * has customer activity (`lastCustomerActivityAt`) newer than the agent's read
 * marker, or no marker at all.
 */
@Injectable()
export class TicketReadsService {
  constructor(
    @InjectRepository(TicketRead) private readonly reads: Repository<TicketRead>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
  ) {}

  markRead(agent: UserId, ticketId: number): Promise<void> {
    return this.write(agent, ticketId, new Date());
  }

  markUnread(agent: UserId, ticketId: number): Promise<void> {
    return this.write(agent, ticketId, null);
  }

  /** Whether each ticket is unread for the agent, from one query. */
  async flags(
    agent: UserId,
    tickets: Array<Pick<Ticket, 'id' | 'lastCustomerActivityAt'>>,
  ): Promise<Map<number, boolean>> {
    const markers = new Map<number, TicketRead>();
    if (tickets.length) {
      const rows = await this.reads.find({
        where: { userId: agent, ticketId: In(tickets.map((t) => t.id)) },
      });
      for (const row of rows) markers.set(row.ticketId, row);
    }
    const flags = new Map<number, boolean>();
    for (const ticket of tickets) {
      flags.set(ticket.id, isUnread(ticket.lastCustomerActivityAt, markers.get(ticket.id)));
    }
    return flags;
  }

  /**
   * Limits a ticket query (alias `ticket`) to the tickets unread for the
   * agent: the rule `flags()` applies, as two EXISTS subqueries.
   */
  onlyUnread(query: SelectQueryBuilder<Ticket>, agent: UserId): SelectQueryBuilder<Ticket> {
    const meta = this.reads.metadata;
    const e = (value: string) => query.connection.driver.escape(value);
    const col = (property: string) =>
      `tr.${e(meta.findColumnWithPropertyName(property)!.databaseName)}`;
    const ticketCol = (property: string) =>
      `${query.alias}.${e(this.tickets.metadata.findColumnWithPropertyName(property)!.databaseName)}`;
    const table = meta.tablePath
      .split('.')
      .map((part) => e(part))
      .join('.');
    const marker = `SELECT 1 FROM ${table} tr WHERE ${col('ticketId')} = ${ticketCol('id')} AND ${col('userId')} = :unreadAgent`;
    return query.andWhere(
      `(EXISTS (${marker} AND ${col('lastReadAt')} IS NULL) OR (${ticketCol('lastCustomerActivityAt')} IS NOT NULL AND NOT EXISTS (${marker} AND ${col('lastReadAt')} >= ${ticketCol('lastCustomerActivityAt')})))`,
      { unreadAgent: agent },
    );
  }

  /** Removes every marker of a ticket (the foreign key cascades too). */
  async forget(ticketIds: number[]): Promise<void> {
    if (ticketIds.length) await this.reads.delete({ ticketId: In(ticketIds) });
  }

  private async write(agent: UserId, ticketId: number, at: Date | null): Promise<void> {
    const updated = await this.reads.update({ userId: agent, ticketId }, { lastReadAt: at });
    if (updated.affected) return;
    try {
      await this.reads.insert({ userId: agent, ticketId, lastReadAt: at });
    } catch {
      // Another request created the marker between the update and the insert.
      await this.reads.update({ userId: agent, ticketId }, { lastReadAt: at });
    }
  }
}

/** The ADR's rule for one ticket and the agent's marker (if any). */
export function isUnread(
  activity: Date | string | null | undefined,
  marker: Pick<TicketRead, 'lastReadAt'> | undefined,
): boolean {
  if (marker && marker.lastReadAt == null) return true;
  if (activity == null) return false;
  if (!marker) return true;
  return new Date(activity).getTime() > new Date(marker.lastReadAt!).getTime();
}

/**
 * Whether a reply is customer-side activity: a public reply or chat message
 * written by the ticket's requester, or by a guest (no author). Agents'
 * replies, internal notes and system messages are not.
 */
export function isCustomerSideReply(
  reply: { isInternal?: boolean; type?: string; userId?: UserId | null },
  ticket: { requesterId?: UserId | null },
): boolean {
  if (reply.isInternal || (reply.type ?? 'reply') !== 'reply') return false;
  const author = reply.userId;
  if (author == null || author === '' || String(author) === '0') return true;
  return ticket.requesterId != null && String(author) === String(ticket.requesterId);
}
