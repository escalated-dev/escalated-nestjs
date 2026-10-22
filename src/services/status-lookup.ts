import type { Repository } from 'typeorm';
import type { TicketStatus } from '../entities/ticket-status.entity';

/**
 * The status a status-change input names: a slug (built-in or custom), or a
 * status id. A slug wins over an id that reads the same. Null when neither
 * matches.
 */
export async function findStatusBySlugOrId(
  statuses: Repository<TicketStatus>,
  value: unknown,
): Promise<TicketStatus | null> {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const bySlug = await statuses.findOne({ where: { slug: text } });
  if (bySlug) return bySlug;
  if (/^\d+$/.test(text)) return statuses.findOne({ where: { id: Number(text) } });
  return null;
}
