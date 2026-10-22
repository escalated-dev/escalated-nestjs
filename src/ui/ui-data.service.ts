import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import { AgentProfile } from '../entities/agent-profile.entity';
import { Contact } from '../entities/contact.entity';
import { Department } from '../entities/department.entity';
import { Reply } from '../entities/reply.entity';
import { Tag } from '../entities/tag.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketFollower } from '../entities/ticket-follower.entity';
import { SatisfactionRating } from '../entities/satisfaction-rating.entity';
import { ReplyService } from '../services/reply.service';
import { serializeAttachment } from './serializers';
import { TicketService } from '../services/ticket.service';
import { CannedResponseService } from '../services/canned-response.service';
import { MacroService } from '../services/macro.service';
import { TicketSubjectService } from '../services/ticket-subject.service';
import { CannedResponse } from '../entities/canned-response.entity';
import { Macro } from '../entities/macro.entity';
import { ApiToken } from '../entities/api-token.entity';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { groupPermissions, serializeApiToken, serializeRole } from './admin-people';
import { slugify } from './admin-config';
import { Webhook } from '../entities/webhook.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import {
  serializeCannedResponse,
  serializeDelivery,
  serializeMacro,
  serializeWebhook,
} from './admin-config';
import {
  paginate,
  serializeActivity,
  serializeReply,
  serializeTicket,
  type UserDirectory,
} from './serializers';

const SORTABLE: Record<string, string> = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  priority: 'priority',
  subject: 'subject',
  reference: 'referenceNumber',
};

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(): Date {
  const date = startOfToday();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function positiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

function truthy(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1 || value === '';
}

/**
 * Loads and shapes what the screens show. Queries run inside the request's
 * ticket-access scope like every other ticket query.
 */
@Injectable()
export class UiDataService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Reply) private readonly replies: Repository<Reply>,
    @InjectRepository(Department) private readonly departments: Repository<Department>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(TicketFollower) private readonly followers: Repository<TicketFollower>,
    @InjectRepository(SatisfactionRating)
    private readonly ratings: Repository<SatisfactionRating>,
    @InjectRepository(Macro) private readonly macroRows: Repository<Macro>,
    @InjectRepository(CannedResponse) private readonly cannedRows: Repository<CannedResponse>,
    @InjectRepository(Webhook) private readonly webhookRows: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRows: Repository<WebhookDelivery>,
    @InjectRepository(Role) private readonly roleRows: Repository<Role>,
    @InjectRepository(Permission) private readonly permissionRows: Repository<Permission>,
    @InjectRepository(ApiToken) private readonly tokenRows: Repository<ApiToken>,
    private readonly replyService: ReplyService,
    private readonly ticketService: TicketService,
    private readonly cannedResponseService: CannedResponseService,
    private readonly macroService: MacroService,
    private readonly ticketSubjectService: TicketSubjectService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  /** Names for host user ids: the host's `ui.resolveUsers`, then agent display names. */
  async directory(ids: Array<UserId | null | undefined>): Promise<UserDirectory> {
    const wanted = [...new Set(ids.filter((id) => id != null && id !== '').map(String))];
    const directory: UserDirectory = new Map();
    if (!wanted.length) return directory;

    const profiles = await this.profiles.find({
      where: { userId: In(wanted) },
      select: { userId: true, displayName: true },
    });
    for (const profile of profiles) {
      directory.set(String(profile.userId), { id: profile.userId, name: profile.displayName });
    }

    const resolveUsers = this.options?.ui?.resolveUsers;
    if (resolveUsers) {
      for (const user of (await resolveUsers(wanted)) ?? []) {
        if (user?.id == null) continue;
        const known = directory.get(String(user.id));
        directory.set(String(user.id), {
          id: user.id,
          name: user.name || known?.name || null,
          email: user.email ?? known?.email ?? null,
        });
      }
    }
    return directory;
  }

  /** A ticket by its id or its reference, as the screens link to it. */
  async ticket(param: string): Promise<Ticket> {
    if (/^\d+$/.test(param)) return this.ticketService.findById(Number(param));
    if (/^[A-Za-z0-9-]{1,64}$/.test(param)) return this.ticketService.findByReference(param);
    throw new NotFoundException('Ticket not found');
  }

  async departmentOptions() {
    const rows = await this.departments.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((d) => ({ id: d.id, name: d.name }));
  }

  async tagOptions() {
    const rows = await this.tagRepo.find({ order: { name: 'ASC' } });
    return rows.map((t) => ({ id: t.id, name: t.name, color: t.color }));
  }

  /** Tickets shaped for a list, with the latest public reply of each. */
  async serializeTickets(rows: Ticket[]) {
    const latest = new Map<number, Reply>();
    if (rows.length) {
      const replies = await this.replies.find({
        where: { ticketId: In(rows.map((t) => t.id)), isInternal: false },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
      for (const reply of replies)
        if (!latest.has(reply.ticketId)) latest.set(reply.ticketId, reply);
    }
    const contactIds = rows.map((t) => t.contactId).filter((id): id is number => id != null);
    const contacts = new Map<number, Contact>();
    if (contactIds.length) {
      for (const contact of await this.contacts.findBy({ id: In(contactIds) })) {
        contacts.set(contact.id, contact);
      }
    }
    const directory = await this.directory([
      ...rows.flatMap((t) => [t.requesterId, t.assigneeId]),
      ...[...latest.values()].map((r) => r.userId),
    ]);
    return rows.map((ticket) =>
      serializeTicket(ticket, directory, {
        latestReply: latest.get(ticket.id) ?? null,
        contact: ticket.contactId != null ? (contacts.get(ticket.contactId) ?? null) : null,
      }),
    );
  }

  private base(): SelectQueryBuilder<Ticket> {
    return this.tickets
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.status', 'status')
      .leftJoinAndSelect('ticket.department', 'department')
      .leftJoinAndSelect('ticket.tags', 'tags')
      .where('ticket.isMerged = :merged', { merged: false });
  }

  private open(query: SelectQueryBuilder<Ticket>): SelectQueryBuilder<Ticket> {
    return query.andWhere(
      new Brackets((q) =>
        q.where('status.id IS NULL').orWhere('status.isClosed = :closed', { closed: false }),
      ),
    );
  }

  private breached(query: SelectQueryBuilder<Ticket>): SelectQueryBuilder<Ticket> {
    return query.andWhere(
      new Brackets((q) =>
        q
          .where('ticket.slaBreached = :yes', { yes: true })
          .orWhere('ticket.slaFirstResponseBreached = :yes', { yes: true })
          .orWhere('ticket.slaResolutionBreached = :yes', { yes: true }),
      ),
    );
  }

  /** `Escalated/Agent/Dashboard`, as escalated-laravel's Agent\DashboardController. */
  async agentDashboard(userId: UserId) {
    const [open, mine, unassigned, breached, resolvedToday, resolvedThisWeek] = await Promise.all([
      this.open(this.base()).getCount(),
      this.open(this.base()).andWhere('ticket.assigneeId = :me', { me: userId }).getCount(),
      this.open(this.base()).andWhere('ticket.assigneeId IS NULL').getCount(),
      this.breached(this.open(this.base())).getCount(),
      this.base().andWhere('ticket.resolvedAt >= :today', { today: startOfToday() }).getCount(),
      this.base()
        .andWhere('ticket.assigneeId = :me', { me: userId })
        .andWhere('ticket.resolvedAt >= :week', { week: startOfWeek() })
        .getCount(),
    ]);

    const [recent, breaching, urgent] = await Promise.all([
      this.base()
        .orderBy('ticket.createdAt', 'DESC')
        .addOrderBy('ticket.id', 'DESC')
        .take(10)
        .getMany(),
      this.breached(this.open(this.base())).orderBy('ticket.createdAt', 'DESC').take(5).getMany(),
      this.open(this.base())
        .andWhere('ticket.assigneeId IS NULL')
        .andWhere('ticket.priority IN (:...urgent)', { urgent: ['urgent', 'critical'] })
        .orderBy('ticket.createdAt', 'DESC')
        .take(5)
        .getMany(),
    ]);

    return {
      stats: {
        open,
        my_assigned: mine,
        unassigned,
        sla_breached: breached,
        resolved_today: resolvedToday,
      },
      recentTickets: await this.serializeTickets(recent),
      needsAttention: {
        sla_breaching: await this.serializeTickets(breaching),
        unassigned_urgent: await this.serializeTickets(urgent),
      },
      myPerformance: { resolved_this_week: resolvedThisWeek },
    };
  }

  /**
   * A ticket list with escalated-laravel's filter names: `status` (slug),
   * `priority`, `ticket_type`, `department_id`, `assigned_to`, `unassigned`,
   * `search`, `sla_breached`, `tag_ids`, `following`, `requester_id`,
   * `sort_by`, `sort_dir`, `per_page`, `page`.
   */
  async ticketList(
    filters: Record<string, any>,
    userId: UserId | null,
    path: string,
    scope: { requesterId?: UserId } = {},
  ) {
    const query = this.base();
    if (scope.requesterId != null) {
      query.andWhere('ticket.requesterId = :requester', { requester: scope.requesterId });
    }
    if (typeof filters.status === 'string' && filters.status) {
      query.andWhere('status.slug = :status', { status: filters.status });
    }
    if (typeof filters.priority === 'string' && filters.priority) {
      query.andWhere('ticket.priority = :priority', { priority: filters.priority });
    }
    if (typeof filters.ticket_type === 'string' && filters.ticket_type) {
      query.andWhere('ticket.ticketType = :type', { type: filters.ticket_type });
    }
    if (filters.department_id != null && filters.department_id !== '') {
      query.andWhere('ticket.departmentId = :department', {
        department: Number(filters.department_id),
      });
    }
    if (filters.assigned_to != null && filters.assigned_to !== '') {
      query.andWhere('ticket.assigneeId = :assignee', { assignee: String(filters.assigned_to) });
    }
    if (filters.unassigned != null && truthy(filters.unassigned)) {
      query.andWhere('ticket.assigneeId IS NULL');
    }
    if (filters.sla_breached != null && truthy(filters.sla_breached)) this.breached(query);
    if (typeof filters.search === 'string' && filters.search.trim()) {
      // Matched as the JSON API's ticket search matches.
      const search = `%${filters.search.trim()}%`;
      query.andWhere(
        new Brackets((q) =>
          q
            .where('ticket.subject LIKE :search', { search })
            .orWhere('ticket.referenceNumber LIKE :search', { search })
            .orWhere('ticket.description LIKE :search', { search }),
        ),
      );
    }
    const tagIds = (Array.isArray(filters.tag_ids) ? filters.tag_ids : [filters.tag_ids])
      .map(Number)
      .filter((id: number) => Number.isInteger(id) && id > 0);
    if (tagIds.length) {
      query.innerJoin('ticket.tags', 'filterTag', 'filterTag.id IN (:...tagIds)', { tagIds });
    }
    if (filters.following != null && userId != null) {
      const followed = await this.followers.find({ where: { userId }, select: { ticketId: true } });
      query.andWhere('ticket.id IN (:...followed)', {
        followed: followed.length ? followed.map((f) => f.ticketId) : [0],
      });
    }

    const sort = SORTABLE[String(filters.sort_by ?? '')] ?? 'createdAt';
    const direction = String(filters.sort_dir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const perPage = positiveInt(filters.per_page, 25, 100);
    const page = positiveInt(filters.page, 1);
    query
      .orderBy(`ticket.${sort}`, direction)
      .addOrderBy('ticket.id', direction)
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await query.getManyAndCount();
    return paginate(await this.serializeTickets(rows), total, page, perPage, path, filters);
  }

  /**
   * What a staff ticket screen reads (`Agent/TicketShow`, `Admin/Tickets/Show`),
   * as escalated-laravel's Agent and Admin TicketController@show send it.
   */
  async ticketScreen(ticket: Ticket, userId: UserId) {
    const id = ticket.id;
    const [replies, activities, chat, requesterTicketCount, related, subjects] = await Promise.all([
      this.replyService.findByTicketId(id, true),
      this.ticketService.getActivities(id),
      this.ticketService.getChatContext(id),
      this.ticketService.getRequesterTicketCount(ticket.requesterId),
      this.ticketService.getRelatedTickets(id),
      this.ticketSubjectService.serializeForTicket(ticket),
    ]);
    const [serialized] = await this.serializeTickets([ticket]);
    const directory = await this.directory([
      ...replies.map((r) => r.userId),
      ...activities.map((a) => a.userId),
    ]);
    const newestFirst = [...replies].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id,
    );
    const rating = await this.ratings.findOne({ where: { ticketId: id } });
    const snoozed = ticket.snoozedUntil != null && new Date(ticket.snoozedUntil) > new Date();

    return {
      ticket: {
        ...serialized,
        is_snoozed: snoozed,
        replies: newestFirst.map((reply) => serializeReply(reply, directory)),
        activities: activities.slice(0, 20).map((a) => serializeActivity(a, directory)),
        attachments: replies.flatMap((reply) => reply.attachments ?? []).map(serializeAttachment),
        pinned_notes: [],
        subjects,
        satisfaction_rating: rating
          ? { rating: rating.rating, comment: rating.comment ?? null }
          : null,
        chat_session_id: chat?.chat_session_id ?? null,
        chat_started_at: chat?.chat_started_at ?? null,
        chat_messages: (chat?.chat_messages ?? []).map((reply) => serializeReply(reply, directory)),
        chat_metadata: chat?.chat_metadata ?? null,
        requester_ticket_count: requesterTicketCount,
        related_tickets: related.map((t) => ({
          id: t.id,
          reference: t.referenceNumber,
          subject: t.subject,
          status: t.status,
        })),
      },
      departments: await this.departmentOptions(),
      tags: await this.tagOptions(),
      cannedResponses: (await this.cannedResponses(userId, ticket.departmentId)).map((c) => ({
        id: c.id,
        title: c.title,
        body: c.content,
        short_code: c.shortCode ?? null,
      })),
      macros: (await this.macros(userId)).map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description ?? null,
      })),
      is_following: await this.isFollowing(id, userId),
      followers_count: await this.followerCount(id),
      is_snoozed: snoozed,
    };
  }

  /**
   * The staff a ticket can be assigned to, as `{ id, name, email }`: every
   * active agent profile, named by the host's `ui.resolveUsers` when given.
   */
  async agentOptions() {
    const profiles = await this.profiles.find({
      where: { isActive: true },
      order: { displayName: 'ASC', id: 'ASC' },
    });
    const directory = await this.directory(profiles.map((p) => p.userId));
    return profiles.map((profile) => {
      const user = directory.get(String(profile.userId));
      return {
        id: profile.userId,
        name: user?.name || profile.displayName || `User #${profile.userId}`,
        email: user?.email ?? null,
      };
    });
  }

  /** Canned responses the agent may use: shared ones and their own. */
  async cannedResponses(userId: UserId, departmentId?: number | null) {
    return this.cannedResponseService.findAll(userId as number, departmentId ?? undefined);
  }

  /** Macros the agent may apply: shared ones and their own. */
  async macros(userId: UserId) {
    return this.macroService.findAll(userId);
  }

  /**
   * `Escalated/Customer/Show`'s ticket: the allow-listed fields of Laravel's
   * `CustomerTicketPayload::customerWeb`. No internal notes, no assignee or
   * metadata, and staff by display name only.
   */
  async customerTicket(ticket: Ticket) {
    const replies = (await this.replyService.findByTicketId(ticket.id, false)).filter(
      (reply) => !reply.isInternal,
    );
    const directory = await this.directory(replies.map((reply) => reply.userId));
    const rating = await this.ratings.findOne({ where: { ticketId: ticket.id } });
    const newestFirst = [...replies].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id,
    );
    const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);
    return {
      reference: ticket.referenceNumber,
      subject: ticket.subject,
      description: ticket.description ?? '',
      status: ticket.status?.slug ?? null,
      priority: ticket.priority,
      channel: ticket.channel ?? null,
      department: ticket.department ? { name: ticket.department.name } : null,
      attachments: replies.flatMap((reply) => reply.attachments ?? []).map(serializeAttachment),
      replies: newestFirst.map((reply) => ({
        id: reply.id,
        body: reply.body,
        is_internal_note: false,
        is_pinned: false,
        author: {
          name:
            String(reply.userId) === String(ticket.requesterId)
              ? 'You'
              : directory.get(String(reply.userId))?.name || 'Support',
        },
        attachments: (reply.attachments ?? []).map(serializeAttachment),
        created_at: iso(reply.createdAt),
      })),
      satisfaction_rating: rating
        ? { rating: rating.rating, comment: rating.comment ?? null }
        : null,
      resolved_at: iso(ticket.resolvedAt),
      closed_at: iso(ticket.closedAt),
      created_at: iso(ticket.createdAt),
      updated_at: iso(ticket.updatedAt),
    };
  }

  serializeDepartment(department: Department, counts: { tickets?: number; agents?: number } = {}) {
    return {
      id: department.id,
      name: department.name,
      slug: department.slug,
      description: department.description ?? null,
      is_active: department.isActive !== false,
      tickets_count: counts.tickets ?? 0,
      agents_count: counts.agents ?? 0,
      created_at: department.createdAt ? new Date(department.createdAt).toISOString() : null,
      updated_at: department.updatedAt ? new Date(department.updatedAt).toISOString() : null,
    };
  }

  private counts(rows: Array<{ id: unknown; count: unknown }>): Map<number, number> {
    return new Map(rows.map((row) => [Number(row.id), Number(row.count)]));
  }

  /** `Escalated/Admin/Departments/Index`: every department with ticket and agent counts. */
  async departmentsWithCounts() {
    const [departments, tickets, agents] = await Promise.all([
      this.departments.find({ order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.tickets
        .createQueryBuilder('ticket')
        .select('ticket.departmentId', 'id')
        .addSelect('COUNT(ticket.id)', 'count')
        .where('ticket.departmentId IS NOT NULL')
        .groupBy('ticket.departmentId')
        .getRawMany(),
      this.profiles
        .createQueryBuilder('profile')
        .innerJoin('profile.departments', 'department')
        .select('department.id', 'id')
        .addSelect('COUNT(profile.id)', 'count')
        .groupBy('department.id')
        .getRawMany(),
    ]);
    const ticketCounts = this.counts(tickets);
    const agentCounts = this.counts(agents);
    return departments.map((d) =>
      this.serializeDepartment(d, {
        tickets: ticketCounts.get(d.id),
        agents: agentCounts.get(d.id),
      }),
    );
  }

  /** `Escalated/Admin/Tags/Index`: every tag with its ticket count. */
  async tagsWithCounts() {
    const [tags, tickets] = await Promise.all([
      this.tagRepo.find({ order: { name: 'ASC' } }),
      this.tickets
        .createQueryBuilder('ticket')
        .innerJoin('ticket.tags', 'tag')
        .select('tag.id', 'id')
        .addSelect('COUNT(ticket.id)', 'count')
        .groupBy('tag.id')
        .getRawMany(),
    ]);
    const counts = this.counts(tickets);
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      color: tag.color,
      tickets_count: counts.get(tag.id) ?? 0,
    }));
  }

  /** `Escalated/Admin/Macros/Index`: every macro, shared and personal, with its creator. */
  async adminMacros() {
    const rows = await this.macroRows.find({ order: { name: 'ASC', id: 'ASC' } });
    const directory = await this.directory(rows.map((m) => m.createdBy));
    return rows.map((macro) => serializeMacro(macro, directory));
  }

  /** `Escalated/Admin/CannedResponses/Index`: every canned response with its creator. */
  async adminCannedResponses() {
    const rows = await this.cannedRows.find({ order: { title: 'ASC', id: 'ASC' } });
    const directory = await this.directory(rows.map((r) => r.createdBy));
    return rows.map((response) => serializeCannedResponse(response, directory));
  }

  /** `Escalated/Admin/Webhooks/Index`: newest first, each with its latest delivery and count. */
  async adminWebhooks() {
    const rows = await this.webhookRows.find({ order: { createdAt: 'DESC', id: 'DESC' } });
    return Promise.all(
      rows.map(async (webhook) => {
        const [latest, count] = await Promise.all([
          this.deliveryRows.findOne({
            where: { webhookId: webhook.id },
            order: { createdAt: 'DESC', id: 'DESC' },
          }),
          this.deliveryRows.countBy({ webhookId: webhook.id }),
        ]);
        return serializeWebhook(webhook, latest, count);
      }),
    );
  }

  /** `Escalated/Admin/Webhooks/DeliveryLog`'s deliveries: a paginator, newest first. */
  async webhookDeliveries(webhookId: number, page: unknown, path: string) {
    const perPage = 25;
    const current = positiveInt(page, 1);
    const [rows, total] = await this.deliveryRows.findAndCount({
      where: { webhookId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (current - 1) * perPage,
      take: perPage,
    });
    return paginate(rows.map(serializeDelivery), total, current, perPage, path);
  }

  /** `Escalated/Admin/Roles/Index`: every role with the agents who have it (`users_count`). */
  async adminRoles() {
    const [roles, counts] = await Promise.all([
      this.roleRows.find({ relations: { permissions: true }, order: { name: 'ASC' } }),
      this.profiles
        .createQueryBuilder('profile')
        .select('profile.roleId', 'id')
        .addSelect('COUNT(profile.id)', 'count')
        .where('profile.roleId IS NOT NULL')
        .groupBy('profile.roleId')
        .getRawMany(),
    ]);
    const byRole = this.counts(counts);
    return roles.map((role) => serializeRole(role, byRole.get(role.id) ?? 0));
  }

  async role(id: number) {
    const role = await this.roleRows.findOne({ where: { id }, relations: { permissions: true } });
    if (!role) throw new NotFoundException('Role not found');
    return serializeRole(role);
  }

  /** Every permission, grouped as the role form's permission matrix reads them. */
  async groupedPermissions() {
    return groupPermissions(
      await this.permissionRows.find({ order: { group: 'ASC', name: 'ASC' } }),
    );
  }

  /** A slug no other role has, from a new role's name. */
  async uniqueRoleSlug(name: string): Promise<string> {
    const base = slugify(name).replace(/_/g, '-') || 'role';
    let slug = base;
    for (let n = 2; await this.roleRows.existsBy({ slug }); n += 1) slug = `${base}-${n}`;
    return slug;
  }

  /** `Escalated/Admin/ApiTokens/Index`'s tokens, newest first, never the token itself. */
  async adminApiTokens() {
    const tokens = await this.tokenRows.find({ order: { createdAt: 'DESC', id: 'DESC' } });
    const directory = await this.directory(tokens.map((t) => t.userId));
    return tokens.map((token) => serializeApiToken(token, directory));
  }

  async isFollowing(ticketId: number, userId: UserId): Promise<boolean> {
    return this.followers.existsBy({ ticketId, userId });
  }

  async followerCount(ticketId: number): Promise<number> {
    return this.followers.countBy({ ticketId });
  }

  /** Follows the ticket, or stops following it. Returns whether it is now followed. */
  async toggleFollow(ticketId: number, userId: UserId): Promise<boolean> {
    const existing = await this.followers.findOne({ where: { ticketId, userId } });
    if (existing) {
      await this.followers.remove(existing);
      return false;
    }
    await this.followers.save(this.followers.create({ ticketId, userId }));
    return true;
  }
}
