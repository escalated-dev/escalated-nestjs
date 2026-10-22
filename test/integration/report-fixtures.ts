import { DataSource } from 'typeorm';
import {
  AgentProfile,
  Department,
  SatisfactionRating,
  SlaPolicy,
  Tag,
  Ticket,
  TicketStatus,
} from '../../src/entities';

export const REPORT_AGENT = 7;

/**
 * A small helpdesk to report on, relative to `now` (whole seconds, so every
 * database stores the times exactly):
 *
 * - `answered`: created 10h ago, first response after 2h, resolved after 6h,
 *   agent 7, Billing, high, email, incident, Gold policy, first response
 *   breached, tagged vip, rated 4.
 * - `waiting`: created 5h ago, first response after 30 minutes, unresolved,
 *   agent 7, low, web, Gold policy, resolution due in 2h, rated 2.
 * - `fresh`: created 1h ago, unassigned, medium, first response due in 30
 *   minutes.
 * - `old`: created 40 days ago, outside a 30-day report.
 */
export async function seedReports(source: DataSource, now: Date) {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  const statuses = source.getRepository(TicketStatus);
  const open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
  const resolved = await statuses.save({ name: 'Resolved', slug: 'resolved', isClosed: true });
  const billing = await source.getRepository(Department).save({ name: 'Billing', slug: 'billing' });
  const gold = await source
    .getRepository(SlaPolicy)
    .save({ name: 'Gold', isActive: true, firstResponseHigh: 60 });
  const vip = await source.getRepository(Tag).save({ name: 'vip', slug: 'vip' });
  await source.getRepository(AgentProfile).save({ userId: REPORT_AGENT, displayName: 'Ada' });

  const tickets = source.getRepository(Ticket);
  let n = 0;
  const ticket = async (createdAt: Date, data: Partial<Ticket>) => {
    const saved = await tickets.save({
      referenceNumber: `REP-${++n}`,
      subject: `Report ticket ${n}`,
      description: 'x',
      requesterId: 300,
      statusId: open.id,
      ...data,
    } as Partial<Ticket>);
    await tickets.update(saved.id, { createdAt });
    return saved;
  };

  const answered = await ticket(ago(10), {
    firstRespondedAt: ago(8),
    resolvedAt: ago(4),
    assigneeId: REPORT_AGENT,
    departmentId: billing.id,
    priority: 'high',
    channel: 'email',
    ticketType: 'incident',
    slaPolicyId: gold.id,
    slaBreached: true,
    slaFirstResponseBreached: true,
    statusId: resolved.id,
  } as Partial<Ticket>);
  await tickets.createQueryBuilder().relation(Ticket, 'tags').of(answered.id).add(vip.id);

  const waiting = await ticket(ago(5), {
    firstRespondedAt: ago(4.5),
    assigneeId: REPORT_AGENT,
    priority: 'low',
    channel: 'web',
    slaPolicyId: gold.id,
    resolutionDueAt: new Date(now.getTime() + 2 * 3_600_000),
  } as Partial<Ticket>);

  const fresh = await ticket(ago(1), {
    priority: 'medium',
    channel: 'web',
    firstResponseDueAt: new Date(now.getTime() + 30 * 60_000),
  } as Partial<Ticket>);

  const old = await ticket(ago(40 * 24), { priority: 'high', channel: 'web' } as Partial<Ticket>);

  const ratings = source.getRepository(SatisfactionRating);
  await ratings.save({ ticketId: answered.id, customerId: 300, rating: 4 });
  await ratings.save({ ticketId: waiting.id, customerId: 300, rating: 2 });

  return { open, resolved, billing, gold, vip, answered, waiting, fresh, old };
}
