import { randomUUID } from 'crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { TicketAccess } from '../config/ticket-access';
import type { UserId } from '../config/user-id-column';
import { AgentNotification } from '../entities/agent-notification.entity';
import { Ticket } from '../entities/ticket.entity';
import { routeUrl } from '../ui/routes';
import { uiEnabled } from '../ui/ui-options';

export const NOTIFICATIONS_PER_PAGE = 20;
export const NOTIFICATIONS_MAX_PER_PAGE = 50;

/** The feed's types (ADR 2026-11-05-agent-panel-data, section 4). */
export type AgentNotificationType =
  | 'ticket_assigned'
  | 'ticket_reply'
  | 'mention'
  | 'sla_warning'
  | 'sla_breached'
  | 'chat_transferred';

const TITLES: Record<string, (reference: string, data: Record<string, unknown>) => string> = {
  ticket_assigned: (r) => `${r} was assigned to you`,
  ticket_reply: (r) => `New reply on ${r}`,
  mention: (r, d) => `${String(d.mentioned_by ?? 'Someone')} mentioned you on ${r}`,
  sla_warning: (r) => `SLA due soon on ${r}`,
  sla_breached: (r) => `SLA breached on ${r}`,
  chat_transferred: (r) => `A chat was transferred to you (${r})`,
};
const UNAVAILABLE = 'A ticket you can no longer view';

export interface AgentNotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  ticket: { id: number; reference: string; subject: string } | null;
  url: string | null;
  created_at: string | null;
  read_at: string | null;
}

/** Where a new item goes in realtime: the gateway, when websockets are on. */
export interface AgentNotificationBroadcaster {
  agentNotification(agentId: UserId, item: AgentNotificationItem): void;
}
export const AGENT_NOTIFICATION_BROADCASTER = 'ESCALATED_AGENT_NOTIFICATION_BROADCASTER';

/**
 * The agents' in-app notifications, in `escalated_notifications`. The feed is
 * on unless `agentNotifications: false`.
 */
@Injectable()
export class AgentNotificationsService {
  constructor(
    @InjectRepository(AgentNotification) private readonly rows: Repository<AgentNotification>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
    @Optional() private readonly access?: TicketAccess,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  available(): boolean {
    return this.options?.agentNotifications !== false;
  }

  /**
   * Stores a notification for an agent, unless they caused it, and broadcasts
   * it on their channel when realtime is on.
   */
  async notify(
    agent: UserId | null | undefined,
    type: AgentNotificationType,
    ticket: Pick<Ticket, 'id' | 'referenceNumber'> | null,
    data: Record<string, unknown> = {},
    causer: UserId | null = null,
  ): Promise<void> {
    if (!this.available() || agent == null || String(agent) === '' || String(agent) === '0') {
      return;
    }
    if (causer != null && String(causer) === String(agent)) return;

    const row = await this.rows.save(
      this.rows.create({
        id: randomUUID(),
        userId: agent,
        type,
        data: {
          ...data,
          ticket_id: ticket?.id ?? null,
          reference: ticket?.referenceNumber ?? null,
        },
        readAt: null,
        createdAt: new Date(),
      }),
    );
    this.broadcast(agent, row).catch(() => undefined);
  }

  /** The agent's notifications, newest first. */
  async page(
    agent: UserId,
    page: number,
    perPage: number,
    unreadOnly: boolean,
  ): Promise<{ items: AgentNotificationItem[]; total: number }> {
    const where = { userId: agent, ...(unreadOnly ? { readAt: IsNull() } : {}) };
    const [rows, total] = await this.rows.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return { items: await this.present(rows), total };
  }

  unreadCount(agent: UserId): Promise<number> {
    return this.rows.count({ where: { userId: agent, readAt: IsNull() } });
  }

  /** Marks one of the agent's notifications read; false when it is not theirs. */
  async markRead(agent: UserId, id: string): Promise<boolean> {
    const row = await this.rows.findOne({ where: { id, userId: agent } });
    if (!row) return false;
    if (row.readAt == null) await this.rows.update({ id, userId: agent }, { readAt: new Date() });
    return true;
  }

  async markAllRead(agent: UserId): Promise<void> {
    await this.rows.update({ userId: agent, readAt: IsNull() }, { readAt: new Date() });
  }

  /**
   * Feed items. Ticket lookups run in the request's ticket-access scope, so a
   * ticket the agent can no longer view (or a deleted one) is redacted.
   */
  async present(rows: AgentNotification[]): Promise<AgentNotificationItem[]> {
    const ids = [
      ...new Set(
        rows
          .map((row) => Number(row.data?.ticket_id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const tickets = new Map<number, Ticket>();
    if (ids.length) {
      for (const ticket of await this.tickets.find({
        where: { id: In(ids) },
        select: { id: true, referenceNumber: true, subject: true },
      })) {
        tickets.set(ticket.id, ticket);
      }
    }
    return rows.map((row) => this.item(row, tickets));
  }

  item(row: AgentNotification, tickets: Map<number, Ticket>): AgentNotificationItem {
    const data = row.data ?? {};
    const ticketId = data.ticket_id == null ? null : Number(data.ticket_id);
    const ticket = ticketId != null ? (tickets.get(ticketId) ?? null) : null;
    const base = {
      id: String(row.id),
      type: row.type,
      created_at: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      read_at: row.readAt ? new Date(row.readAt).toISOString() : null,
    };
    if (ticketId != null && !ticket) {
      return { ...base, title: UNAVAILABLE, body: null, ticket: null, url: null };
    }
    const reference = ticket?.referenceNumber ?? String(data.reference ?? '');
    const title = (TITLES[row.type] ?? ((r: string) => `Update on ${r}`))(reference, data);
    return {
      ...base,
      title,
      body: ticket?.subject ?? null,
      ticket: ticket
        ? { id: ticket.id, reference: ticket.referenceNumber, subject: ticket.subject }
        : null,
      url:
        ticket && uiEnabled(this.options)
          ? routeUrl('escalated.agent.tickets.show', { ticket: ticket.referenceNumber })
          : null,
    };
  }

  private async broadcast(agent: UserId, row: AgentNotification): Promise<void> {
    const broadcaster = this.broadcaster();
    if (!broadcaster) return;
    // Outside a request: check the recipient's own visibility.
    const ticketId = row.data?.ticket_id == null ? null : Number(row.data.ticket_id);
    const tickets = new Map<number, Ticket>();
    if (ticketId != null) {
      const actor = this.access?.enabled() ? await this.access.resolveUser(agent) : null;
      const find = () =>
        this.tickets.findOne({
          where: { id: ticketId },
          select: { id: true, referenceNumber: true, subject: true },
        });
      const ticket = this.access?.enabled()
        ? await this.access.withActor(actor, find)
        : await find();
      if (ticket) tickets.set(ticket.id, ticket);
    }
    broadcaster.agentNotification(agent, this.item(row, tickets));
  }

  private broadcaster(): AgentNotificationBroadcaster | null {
    if (!this.options?.enableWebsockets || !this.moduleRef) return null;
    try {
      return this.moduleRef.get<AgentNotificationBroadcaster>(AGENT_NOTIFICATION_BROADCASTER, {
        strict: false,
      });
    } catch {
      return null;
    }
  }
}
