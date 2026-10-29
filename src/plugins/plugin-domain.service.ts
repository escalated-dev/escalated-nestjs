import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import type { UserId } from '../config/user-id-column';
import { AgentProfile } from '../entities/agent-profile.entity';
import { Department } from '../entities/department.entity';
import { Reply } from '../entities/reply.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { Ticket } from '../entities/ticket.entity';
import { ContactService } from '../services/contact.service';
import { ReplyService } from '../services/reply.service';
import { TagService } from '../services/tag.service';
import { TicketService } from '../services/ticket.service';
import { pluginReply, pluginTicket, type StatusSlugs } from './plugin-payloads';

/** The most rows a query hands back. */
const QUERY_LIMIT = 500;

/** Ticket filter keys a plugin may use, and the entity property each reads. */
const TICKET_FILTERS: Record<string, keyof Ticket> = {
  id: 'id',
  reference: 'referenceNumber',
  status: 'statusId',
  priority: 'priority',
  channel: 'channel',
  ticket_type: 'ticketType',
  department_id: 'departmentId',
  requester_id: 'requesterId',
  contact_id: 'contactId',
  assigned_to: 'assigneeId',
};

function record(value: unknown, what: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${what} requires an object`);
  }
  return value as Record<string, any>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function contactJson(contact: any) {
  if (!contact) return null;
  return {
    id: contact.id,
    name: contact.name ?? null,
    email: contact.email,
    user_id: contact.userId ?? null,
  };
}

/**
 * `ctx.tickets`, `ctx.replies`, `ctx.contacts`, `ctx.tags`, `ctx.departments`
 * and `ctx.agents`, through this package's own services, so tickets and
 * replies a plugin writes fire the same events as any other. Writes take only
 * the fields the plugin contract lists; a plugin never chooses who it acts as.
 */
@Injectable()
export class PluginDomainService {
  constructor(
    private readonly tickets: TicketService,
    private readonly replies: ReplyService,
    private readonly contacts: ContactService,
    private readonly tags: TagService,
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Reply) private readonly replyRepo: Repository<Reply>,
    @InjectRepository(TicketStatus) private readonly statusRepo: Repository<TicketStatus>,
    @InjectRepository(Department) private readonly departmentRepo: Repository<Department>,
    @InjectRepository(AgentProfile) private readonly agentRepo: Repository<AgentProfile>,
  ) {}

  async statusSlugs(): Promise<StatusSlugs> {
    const statuses = await this.statusRepo.find();
    return new Map(statuses.map((status) => [status.id, status.slug]));
  }

  private async statusId(slug: unknown): Promise<number> {
    const status = await this.statusRepo.findOne({ where: { slug: String(slug) } });
    if (!status) throw new Error(`No ticket status "${String(slug)}"`);
    return status.id;
  }

  private async ticketJson(id: number) {
    return pluginTicket(await this.tickets.findById(id), await this.statusSlugs());
  }

  // Tickets

  async findTicket(id: unknown) {
    const ticket = await this.ticketRepo.findOne({
      where: { id: Number(id) },
      relations: { status: true, tags: true },
    });
    return ticket ? pluginTicket(ticket, await this.statusSlugs()) : null;
  }

  async queryTickets(filter: unknown) {
    const where: FindOptionsWhere<Ticket> = {};
    for (const [key, value] of Object.entries(filter ? record(filter, 'ctx.tickets.query') : {})) {
      const property = TICKET_FILTERS[key];
      if (!property) throw new Error(`ctx.tickets.query cannot filter tickets by "${key}"`);
      (where as any)[property] = property === 'statusId' ? await this.statusId(value) : value;
    }
    const rows = await this.ticketRepo.find({
      where,
      relations: { status: true, tags: true },
      order: { id: 'ASC' },
      take: QUERY_LIMIT,
    });
    const statuses = await this.statusSlugs();
    return rows.map((ticket) => pluginTicket(ticket, statuses));
  }

  /**
   * A ticket from a plugin. The requester is the signed-in user of the
   * request the plugin is serving, else the contact named by
   * `requester_email` (found or created), else no user (0).
   */
  async createTicket(input: unknown, actor: UserId | null) {
    const data = record(input, 'ctx.tickets.create');
    const subject = text(data.subject) ?? text(data.title);
    if (!subject) throw new Error('ctx.tickets.create requires subject');
    let contactId: number | null = typeof data.contact_id === 'number' ? data.contact_id : null;
    if (contactId === null && text(data.requester_email)) {
      const contact = await this.contacts.findOrCreateByEmail(
        data.requester_email,
        text(data.requester_name) ?? null,
      );
      contactId = contact.id;
    }
    const created = await this.tickets.create(
      {
        subject,
        description: text(data.description) ?? text(data.body) ?? '',
        priority: text(data.priority),
        ticketType: text(data.ticket_type),
        departmentId: typeof data.department_id === 'number' ? data.department_id : undefined,
        statusId: data.status !== undefined ? await this.statusId(data.status) : undefined,
        channel: text(data.channel) ?? 'api',
        contactId,
        metadata:
          data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
            ? data.metadata
            : null,
      } as any,
      actor ?? 0,
    );
    return this.ticketJson(created.id);
  }

  async updateTicket(id: unknown, input: unknown, actor: UserId | null) {
    const data = record(input, 'ctx.tickets.update');
    const dto: Record<string, unknown> = {};
    const subject = text(data.subject) ?? text(data.title);
    if (subject !== undefined) dto.subject = subject;
    const description = text(data.description) ?? text(data.body);
    if (description !== undefined) dto.description = description;
    if (text(data.priority)) dto.priority = data.priority;
    if (text(data.ticket_type)) dto.ticketType = data.ticket_type;
    if (typeof data.department_id === 'number') dto.departmentId = data.department_id;
    if (data.status !== undefined) dto.statusId = await this.statusId(data.status);
    await this.tickets.update(Number(id), dto as any, actor ?? 0);
    return this.ticketJson(Number(id));
  }

  // Replies

  async findReply(id: unknown) {
    const reply = await this.replyRepo.findOne({ where: { id: Number(id) } });
    return reply ? pluginReply(reply) : null;
  }

  async queryReplies(filter: unknown) {
    const where: FindOptionsWhere<Reply> = {};
    for (const [key, value] of Object.entries(filter ? record(filter, 'ctx.replies.query') : {})) {
      if (key === 'ticket_id') where.ticketId = Number(value);
      else if (key === 'is_internal') where.isInternal = value === true;
      else if (key === 'type') where.type = String(value);
      else throw new Error(`ctx.replies.query cannot filter replies by "${key}"`);
    }
    const rows = await this.replyRepo.find({ where, order: { id: 'ASC' }, take: QUERY_LIMIT });
    return rows.map(pluginReply);
  }

  async createReply(input: unknown, actor: UserId | null) {
    const data = record(input, 'ctx.replies.create');
    if (data.ticket_id === undefined || data.ticket_id === null) {
      throw new Error('ctx.replies.create requires ticket_id');
    }
    const body = text(data.body);
    if (!body) throw new Error('ctx.replies.create requires body');
    const internal = data.is_internal === true;
    const reply = await this.replies.create(
      Number(data.ticket_id),
      { body, isInternal: internal, type: internal ? 'note' : 'reply' },
      actor ?? 0,
    );
    return pluginReply(reply);
  }

  // Contacts (this package's contacts, not host users)

  async findContact(id: unknown) {
    return contactJson(await this.contacts.findById(Number(id)));
  }

  async findContactByEmail(email: unknown) {
    return contactJson(await this.contacts.findByEmail(String(email ?? '')));
  }

  async createContact(input: unknown) {
    const data = record(input, 'ctx.contacts.create');
    const email = text(data.email);
    if (!email) throw new Error('ctx.contacts.create requires email');
    return contactJson(await this.contacts.findOrCreateByEmail(email, text(data.name) ?? null));
  }

  // Tags, departments, agents

  async allTags() {
    return (await this.tags.findAll()).map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      color: tag.color ?? null,
    }));
  }

  async createTag(input: unknown) {
    const data = record(input, 'ctx.tags.create');
    const name = text(data.name);
    if (!name) throw new Error('ctx.tags.create requires name');
    const tag = await this.tags.create({
      name,
      ...(text(data.slug) ? { slug: data.slug } : {}),
      ...(text(data.color) ? { color: data.color } : {}),
    });
    return { id: tag.id, name: tag.name, slug: tag.slug, color: tag.color ?? null };
  }

  private departmentJson(department: Department) {
    return {
      id: department.id,
      name: department.name,
      slug: department.slug,
      is_active: department.isActive !== false,
    };
  }

  async allDepartments() {
    const rows = await this.departmentRepo.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    return rows.map((department) => this.departmentJson(department));
  }

  async findDepartment(id: unknown) {
    const department = await this.departmentRepo.findOne({ where: { id: Number(id) } });
    return department ? this.departmentJson(department) : null;
  }

  private agentJson(profile: AgentProfile) {
    return {
      id: profile.userId,
      name: profile.displayName ?? null,
      email: null,
      is_active: profile.isActive !== false,
      is_available: profile.isAvailable === true,
    };
  }

  async allAgents() {
    return (await this.agentRepo.find({ order: { id: 'ASC' } })).map((p) => this.agentJson(p));
  }

  async findAgent(id: unknown) {
    const profile = await this.agentRepo.findOne({ where: { userId: id as any } });
    return profile ? this.agentJson(profile) : null;
  }
}
