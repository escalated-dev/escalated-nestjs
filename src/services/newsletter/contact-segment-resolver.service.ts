import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Contact } from '../../entities/contact.entity';
import { NewsletterList, NewsletterListMember } from '../../entities/newsletter';

type FilterRule = { field: string; op: string; value: unknown };
type FilterShape = { rules?: FilterRule[] };

@Injectable()
export class ContactSegmentResolverService {
  constructor(
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
    @InjectRepository(NewsletterListMember)
    private readonly members: Repository<NewsletterListMember>,
  ) {}

  /** All contact IDs in this list — no opt-out filtering. */
  async resolve(list: NewsletterList): Promise<number[]> {
    if (list.kind === 'static') {
      const rows = await this.members.find({
        where: { list_id: list.id },
        select: { contact_id: true },
      });
      return rows.map((r) => r.contact_id);
    }
    const qb = this.applyFilter(list.filter_json ?? { rules: [] });
    const rows = await qb.select('contact.id', 'id').getRawMany<{ id: number }>();
    return rows.map((r) => r.id);
  }

  /** Sendable contact IDs (opt-out filtered). Caller still has to filter
   *  hard-bounced emails via BounceSuppressionStore. */
  async resolveSendable(list: NewsletterList): Promise<number[]> {
    if (list.kind === 'static') {
      const memberIds = (
        await this.members.find({ where: { list_id: list.id }, select: { contact_id: true } })
      ).map((r) => r.contact_id);
      if (memberIds.length === 0) return [];
      const rows = await this.contacts
        .createQueryBuilder('contact')
        .where('contact.id IN (:...ids)', { ids: memberIds })
        .andWhere('contact.marketing_opt_out_at IS NULL')
        .select('contact.id', 'id')
        .getRawMany<{ id: number }>();
      return rows.map((r) => r.id);
    }
    const qb = this.applyFilter(list.filter_json ?? { rules: [] });
    qb.andWhere('contact.marketing_opt_out_at IS NULL');
    const rows = await qb.select('contact.id', 'id').getRawMany<{ id: number }>();
    return rows.map((r) => r.id);
  }

  /** Count matches for a dynamic filter, ignoring opt-outs. UI live counter. */
  async countMatches(filter: FilterShape): Promise<number> {
    const qb = this.applyFilter(filter);
    return qb.getCount();
  }

  private applyFilter(filter: FilterShape): SelectQueryBuilder<Contact> {
    const qb = this.contacts.createQueryBuilder('contact');
    let paramIndex = 0;
    for (const rule of filter.rules ?? []) {
      const field = rule.field;
      const op = rule.op || '=';
      const value = rule.value;
      if (!field) continue;
      paramIndex++;
      const param = `p${paramIndex}`;
      if (field.startsWith('metadata.')) {
        // simple-json is stored as a JSON string; SQLite + most ESPs in tests
        // use LIKE for substring containment. Production hosts may swap in a
        // real JSON-path operator.
        qb.andWhere(`contact.metadata LIKE :${param}`, {
          [param]: `%"${field.slice('metadata.'.length)}":${JSON.stringify(value)}%`,
        });
        continue;
      }
      qb.andWhere(`contact.${field} ${op} :${param}`, { [param]: value });
    }
    return qb;
  }
}
