import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import { Contact } from '../entities/contact.entity';
import { Department } from '../entities/department.entity';
import { ImportJob } from '../entities/import-job.entity';
import { ImportSourceMap } from '../entities/import-source-map.entity';
import { Reply } from '../entities/reply.entity';
import { pickDefaultStatus } from '../entities/status-category';
import { Tag } from '../entities/tag.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketStatus } from '../entities/ticket-status.entity';
import { requesterIdForPolicy } from './guest-policy';
import { ImportAdapter, ImportContext, ImportCredentials } from './import-adapter';

const MAX_ERRORS = 10000;
const CONTACT_PREFIX = 'contact:';
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

type ImportRecord = Record<string, unknown>;

/**
 * Keeps import jobs and runs them, as escalated-laravel's ImportService: walk
 * the adapter's entity types in order under ImportContext, resume each from
 * its saved cursor and counters, write every record not yet in the source map,
 * log failures, save progress after each batch, and stop between batches when
 * the job has been paused or cancelled. A completed job drops its credentials.
 *
 * Contacts the host has as users (`importUserIdByEmail`) import as those
 * users; others become Escalated contacts on guest tickets. Agents must exist.
 */
@Injectable()
export class ImportJobService {
  private readonly logger = new Logger('EscalatedImport');
  private readonly running = new Set<Promise<void>>();
  readonly credentials: ImportCredentials;

  constructor(
    @InjectRepository(ImportJob) private readonly jobs: Repository<ImportJob>,
    @InjectRepository(ImportSourceMap) private readonly maps: Repository<ImportSourceMap>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketStatus) private readonly statuses: Repository<TicketStatus>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(Department) private readonly departments: Repository<Department>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Reply) private readonly replies: Repository<Reply>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {
    const secret =
      this.options?.importSecret ||
      this.options?.guestAccess?.secret ||
      process.env.ESCALATED_GUEST_ACCESS_SECRET ||
      this.options?.inbound?.replySecret ||
      randomBytes(32).toString('hex');
    this.credentials = new ImportCredentials(secret);
  }

  adapters(): ImportAdapter[] {
    return this.options?.importAdapters ?? [];
  }

  adapter(platform: string): ImportAdapter | undefined {
    return this.adapters().find((a) => a.name() === platform);
  }

  /**
   * Queues the job: the host's `importDispatcher` (its queue calls `run`), or
   * a run in this process after the response.
   */
  dispatch(jobId: string): void {
    if (this.options?.importDispatcher) {
      this.options.importDispatcher(jobId);
      return;
    }
    const run: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.run(jobId))
      .finally(() => this.running.delete(run));
    this.running.add(run);
  }

  /** Resolves once every in-process run started so far has finished. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  /** Runs (or resumes) the job. A run that throws marks the job failed. */
  async run(jobId: string): Promise<void> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job || job.status === 'completed') return;
    try {
      await ImportContext.suppress(() => this.runJob(job));
    } catch (error: any) {
      this.logger.error(`Import ${jobId} failed: ${error?.message ?? error}`);
      await this.jobs.update({ id: jobId }, { status: 'failed' });
    }
  }

  private async runJob(job: ImportJob): Promise<void> {
    const adapter = this.adapter(job.platform);
    if (!adapter) throw new Error(`No adapter found for platform '${job.platform}'.`);
    if (job.status !== 'importing') job.transitionTo('importing');
    await this.jobs.update(
      { id: job.id },
      { status: job.status, startedAt: job.startedAt ?? new Date() },
    );
    const credentials = this.credentials.open(job.credentials) ?? {};

    for (const entityType of adapter.entityTypes()) {
      if (await this.stopped(job.id)) return;
      if (await this.importEntityType(job.id, adapter, entityType, credentials)) return;
    }
    if (await this.stopped(job.id)) return;
    await this.jobs.update(
      { id: job.id },
      { status: 'completed', completedAt: new Date(), credentials: null },
    );
  }

  /** Re-reads the status the admin may have changed: paused, or cancelled (failed). */
  private async stopped(jobId: string): Promise<boolean> {
    const job = await this.jobs.findOne({
      where: { id: jobId },
      select: { id: true, status: true },
    });
    return job?.status === 'paused' || job?.status === 'failed';
  }

  /** @returns true when the job was paused or cancelled mid-type */
  private async importEntityType(
    jobId: string,
    adapter: ImportAdapter,
    entityType: string,
    credentials: Record<string, string>,
  ): Promise<boolean> {
    const job = await this.jobs.findOneOrFail({ where: { id: jobId } });
    const progress = { ...(job.progress ?? {}) };
    const errors = [...(job.errorLog ?? [])];
    const saved: Record<string, unknown> = {
      total: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      cursor: null,
      ...(progress[entityType] ?? {}),
    };
    let processed = Number(saved.processed) || 0;
    let skipped = Number(saved.skipped) || 0;
    let failed = Number(saved.failed) || 0;
    let cursor = typeof saved.cursor === 'string' ? saved.cursor : null;

    for (;;) {
      const result = await adapter.extract(entityType, credentials, cursor);
      for (const record of result.records) {
        const sourceId = text(record.source_id);
        if (!sourceId) {
          failed++;
          continue;
        }
        if (await this.resolve(jobId, entityType, sourceId)) {
          skipped++;
          continue;
        }
        try {
          const escalatedId = await this.persist(jobId, entityType, record);
          await this.maps.insert({ importJobId: jobId, entityType, sourceId, escalatedId });
          processed++;
        } catch (error: any) {
          failed++;
          if (errors.length < MAX_ERRORS) {
            errors.push({
              entity_type: entityType,
              source_id: sourceId,
              error: error?.message ?? String(error),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      Object.assign(saved, { processed, skipped, failed });
      if (result.totalCount !== null && result.totalCount !== undefined) {
        saved.total = result.totalCount;
      }
      // As Laravel's: an exhausted extract keeps the last cursor, so a resume
      // re-reads one page, not the whole type.
      if (result.cursor !== null && result.cursor !== undefined) saved.cursor = result.cursor;
      progress[entityType] = saved;
      // Progress and errors only: the status is the admin's to change mid-run.
      await this.jobs.update({ id: jobId }, { progress, errorLog: errors });

      if (await this.stopped(jobId)) return true;
      if (result.cursor === null || result.cursor === undefined) return false;
      cursor = result.cursor;
    }
  }

  private async resolve(
    jobId: string,
    entityType: string,
    sourceId: string,
  ): Promise<string | null> {
    const map = await this.maps.findOne({ where: { importJobId: jobId, entityType, sourceId } });
    return map?.escalatedId ?? null;
  }

  private ref(jobId: string, entityType: string, sourceId: unknown): Promise<string | null> {
    const id = text(sourceId);
    return id ? this.resolve(jobId, entityType, id) : Promise.resolve(null);
  }

  private async persist(jobId: string, entityType: string, record: ImportRecord): Promise<string> {
    switch (entityType) {
      case 'agents':
        return this.persistAgent(record);
      case 'contacts':
        return this.persistContact(record);
      case 'tags':
        return this.persistTag(record);
      case 'departments':
        return this.persistDepartment(record);
      case 'tickets':
        return this.persistTicket(jobId, record);
      case 'replies':
        return this.persistReply(jobId, record);
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  private async hostUserId(email: string | null): Promise<UserId | null> {
    if (!email || !this.options?.importUserIdByEmail) return null;
    const id = await this.options.importUserIdByEmail(email);
    return id === null || id === undefined || id === '' ? null : id;
  }

  private async persistAgent(record: ImportRecord): Promise<string> {
    const email = text(record.email);
    const id = await this.hostUserId(email);
    if (id === null) throw new Error(`Agent with email '${email}' not found in host application.`);
    return String(id);
  }

  private async persistContact(record: ImportRecord): Promise<string> {
    const email = text(record.email)?.toLowerCase();
    if (!email) throw new Error('Contact has no email.');
    const userId = await this.hostUserId(email);
    if (userId !== null) return String(userId);
    let contact = await this.contacts.findOne({ where: { email } });
    if (!contact) {
      contact = await this.contacts.save(
        this.contacts.create({ email, name: text(record.name), metadata: {} }),
      );
    }
    return CONTACT_PREFIX + contact.id;
  }

  private async persistTag(record: ImportRecord): Promise<string> {
    const name = text(record.name);
    if (!name) throw new Error('Tag has no name.');
    const slug = slugify(name);
    let tag = await this.tags.findOne({ where: { slug } });
    if (!tag) tag = await this.tags.save(this.tags.create({ name, slug }));
    return String(tag.id);
  }

  private async persistDepartment(record: ImportRecord): Promise<string> {
    const name = text(record.name);
    if (!name) throw new Error('Department has no name.');
    const slug = slugify(name);
    let department = await this.departments.findOne({ where: { slug } });
    if (!department) {
      department = await this.departments.save(
        this.departments.create({ name, slug, isActive: true }),
      );
    }
    return String(department.id);
  }

  private async statusId(slug: string | null): Promise<number | undefined> {
    const match = slug ? await this.statuses.findOne({ where: { slug } }) : null;
    if (match) return match.id;
    // As Laravel's TicketStatus::tryFrom: an unknown status is the default one.
    return pickDefaultStatus((await this.statuses.find({ where: { isDefault: true } })) ?? [])?.id;
  }

  private async persistTicket(jobId: string, record: ImportRecord): Promise<string> {
    const subject = text(record.title) ?? text(record.subject) ?? 'Imported ticket';
    const priority = text(record.priority);
    const values: Partial<Ticket> = {
      referenceNumber: reference(),
      subject,
      description: text(record.description) ?? text(record.body) ?? subject,
      priority: priority && PRIORITIES.includes(priority) ? priority : 'medium',
      channel: 'import',
      statusId: await this.statusId(text(record.status)),
      requesterId: requesterIdForPolicy(this.options?.guestPolicy),
      metadata: isRecord(record.metadata)
        ? (record.metadata as Record<string, string | number | boolean>)
        : null,
    };

    const requester = await this.ref(jobId, 'contacts', record.requester_source_id);
    if (requester?.startsWith(CONTACT_PREFIX)) {
      values.contactId = Number(requester.slice(CONTACT_PREFIX.length));
    } else if (requester) {
      values.requesterId = asUserId(requester);
    }
    const assignee = await this.ref(jobId, 'agents', record.assignee_source_id);
    if (assignee) values.assigneeId = asUserId(assignee);
    const department = await this.ref(jobId, 'departments', record.department_source_id);
    if (department) values.departmentId = Number(department);

    const ticket = await this.tickets.save(this.tickets.create(values));
    const tagIds: number[] = [];
    for (const source of Array.isArray(record.tag_source_ids) ? record.tag_source_ids : []) {
      const id = await this.ref(jobId, 'tags', source);
      if (id) tagIds.push(Number(id));
    }
    if (tagIds.length > 0) {
      await this.tickets.createQueryBuilder().relation(Ticket, 'tags').of(ticket.id).add(tagIds);
    }
    await this.keepTimestamps(this.tickets, ticket.id, record);
    return String(ticket.id);
  }

  private async persistReply(jobId: string, record: ImportRecord): Promise<string> {
    const ticketId = await this.ref(jobId, 'tickets', record.ticket_source_id);
    if (!ticketId) throw new Error('Parent ticket not found for reply.');
    const author =
      (await this.ref(jobId, 'agents', record.author_source_id)) ??
      (await this.ref(jobId, 'contacts', record.author_source_id));
    const internal = record.is_internal_note === true || record.is_internal_note === 'true';
    const reply = await this.replies.save(
      this.replies.create({
        ticketId: Number(ticketId),
        body: text(record.body) ?? '',
        isInternal: internal,
        type: internal ? 'note' : 'reply',
        userId:
          author && !author.startsWith(CONTACT_PREFIX)
            ? asUserId(author)
            : requesterIdForPolicy(this.options?.guestPolicy),
      }),
    );
    await this.keepTimestamps(this.replies, reply.id, record);
    return String(reply.id);
  }

  /** The source's created_at / updated_at over the ones set on insert. */
  private async keepTimestamps(repo: Repository<any>, id: number, record: ImportRecord) {
    const set: Record<string, Date> = {};
    for (const [key, property] of [
      ['created_at', 'createdAt'],
      ['updated_at', 'updatedAt'],
    ]) {
      const value = text(record[key]);
      const at = value ? new Date(value) : null;
      if (at && !Number.isNaN(at.getTime())) set[property] = at;
    }
    if (Object.keys(set).length > 0) {
      await repo
        .createQueryBuilder()
        .update()
        .set(set)
        .where('id = :id', { id })
        .updateEntity(false)
        .execute();
    }
  }
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function isRecord(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function asUserId(value: string): UserId {
  return /^\d+$/.test(value) ? Number(value) : value;
}

function reference(): string {
  return `IMP-${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
}
