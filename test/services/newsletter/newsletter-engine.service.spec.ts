import { NewsletterDispatcherService } from '../../../src/services/newsletter/newsletter-dispatcher.service';
import { NewsletterPlannerService } from '../../../src/services/newsletter/newsletter-planner.service';
import { NewsletterTrackerService } from '../../../src/services/newsletter/newsletter-tracker.service';
import { BounceSuppressionStoreService } from '../../../src/services/newsletter/bounce-suppression-store.service';
import { ContactSegmentResolverService } from '../../../src/services/newsletter/contact-segment-resolver.service';

function delivery(id: string, overrides: any = {}) {
  return {
    id,
    newsletter_id: 1,
    contact_id: Number(id),
    email_at_send: `user${id}@example.com`,
    status: 'pending',
    tracking_token: `token${id}`,
    sent_at: null,
    opened_at: null,
    last_clicked_at: null,
    clicks_count: 0,
    bounce_reason: null,
    failure_reason: null,
    attempt_count: 0,
    claimed_at: null,
    next_attempt_at: null,
    is_test: false,
    newsletter: {
      id: 1,
      subject: 'Hello',
      from_email: 'sender@example.com',
      from_name: null,
      reply_to: null,
    },
    contact: { id: Number(id), email: `user${id}@example.com`, name: null, metadata: {} },
    ...overrides,
  };
}

function idsFromCriteria(criteria: any): string[] {
  if (typeof criteria === 'string') return [criteria];
  if (typeof criteria === 'number') return [String(criteria)];
  const raw = criteria?.id?._value ?? criteria?.id;
  return Array.isArray(raw) ? raw.map(String) : raw != null ? [String(raw)] : [];
}

describe('Newsletter engine services', () => {
  describe('NewsletterDispatcherService', () => {
    function buildDispatcher(rows: any[], options: any = {}) {
      const newsletter = { id: 1, status: 'sending', sent_at: null, summary_sent: 0 };
      const newsletters = {
        find: jest.fn(async (opts?: any) =>
          opts?.where?.status === 'sending' && newsletter.status === 'sending' ? [newsletter] : [],
        ),
        update: jest.fn(async (criteria: any, patch: any) => {
          if (criteria === 1 || criteria?.id === 1) Object.assign(newsletter, patch);
        }),
        increment: jest.fn(async (_criteria: any, field: string, amount: number) => {
          newsletter[field] += amount;
        }),
      };
      const deliveries = {
        find: jest.fn(async (opts?: any) => {
          if (Array.isArray(opts?.where) && opts.where.some((w: any) => w.status === 'pending')) {
            return rows
              .filter(
                (row) =>
                  row.status === 'pending' &&
                  (!row.next_attempt_at || row.next_attempt_at <= new Date()),
              )
              .sort((a, b) => Number(a.id) - Number(b.id))
              .slice(0, opts.take);
          }
          if (Array.isArray(opts?.where) && opts.where.some((w: any) => w.status === 'sent')) {
            const statuses = new Set(opts.where.map((w: any) => w.status));
            return rows
              .filter((row) => row.newsletter_id === 1 && statuses.has(row.status))
              .sort((a, b) => Number(a.id) - Number(b.id))
              .slice(0, opts.take);
          }
          return [];
        }),
        findOne: jest.fn(
          async (opts: any) => rows.find((row) => row.id === String(opts.where.id)) ?? null,
        ),
        update: jest.fn(async (criteria: any, patch: any) => {
          const ids = idsFromCriteria(criteria);
          for (const row of rows) {
            if (ids.includes(row.id) || (criteria.status && row.status === criteria.status)) {
              Object.assign(row, patch);
            }
          }
        }),
        count: jest.fn(async (opts: any) => {
          const where = Array.isArray(opts.where) ? opts.where : [opts.where];
          return rows.filter((row) =>
            where.some((w: any) =>
              Object.entries(w).every(([key, value]) => (row as any)[key] === value),
            ),
          ).length;
        }),
      };
      const renderer = {
        render: jest.fn(() => '<p>Hello</p>'),
        unsubscribeUrl: jest.fn(() => 'http://u'),
      };
      const mailer = { sendMail: jest.fn(async () => undefined) };
      const service = new NewsletterDispatcherService(
        {
          enableNewsletters: true,
          appUrl: 'http://localhost',
          newsletters: { batchSize: 50, rateLimitPerMinute: 60, ...options },
        },
        newsletters as any,
        deliveries as any,
        renderer as any,
        mailer as any,
      );
      return { service, rows, newsletters, deliveries, mailer, newsletter };
    }

    it('claims pending rows, sends mail, and marks them sent', async () => {
      const ctx = buildDispatcher([delivery('1')]);
      await ctx.service.dispatchBatch();
      expect(ctx.mailer.sendMail).toHaveBeenCalledTimes(1);
      expect(ctx.rows[0].status).toBe('sent');
      expect(ctx.rows[0].sent_at).toBeInstanceOf(Date);
      expect(ctx.newsletter.summary_sent).toBe(1);
    });

    it('respects batch size', async () => {
      const ctx = buildDispatcher(
        [delivery('1'), delivery('2'), delivery('3'), delivery('4'), delivery('5')],
        { batchSize: 2 },
      );
      await ctx.service.dispatchBatch();
      expect(ctx.mailer.sendMail).toHaveBeenCalledTimes(2);
      expect(ctx.rows.filter((row) => row.status === 'sent')).toHaveLength(2);
    });

    it('does nothing when newsletters are disabled', async () => {
      const ctx = buildDispatcher([delivery('1')]);
      (ctx.service as any).options.enableNewsletters = false;
      await ctx.service.dispatchBatch();
      expect(ctx.mailer.sendMail).not.toHaveBeenCalled();
      expect(ctx.rows[0].status).toBe('pending');
    });

    it('enforces per-minute rate limit across ticks', async () => {
      const ctx = buildDispatcher(
        [delivery('1'), delivery('2'), delivery('3'), delivery('4'), delivery('5')],
        { rateLimitPerMinute: 2 },
      );
      await ctx.service.dispatchBatch();
      await ctx.service.dispatchBatch();
      expect(ctx.mailer.sendMail).toHaveBeenCalledTimes(2);
    });

    it('does not claim deliveries whose next attempt is in the future', async () => {
      const ctx = buildDispatcher([
        delivery('1', { next_attempt_at: new Date(Date.now() + 300_000), attempt_count: 1 }),
      ]);
      await ctx.service.dispatchBatch();
      expect(ctx.mailer.sendMail).not.toHaveBeenCalled();
      expect(ctx.rows[0].status).toBe('pending');
    });

    it('backs off failures and auto-pauses high-bounce campaigns', async () => {
      const ctx = buildDispatcher(
        [
          delivery('1', { status: 'bounced' }),
          delivery('2', { status: 'sent' }),
          delivery('3', { status: 'sent' }),
          delivery('4', { status: 'sent' }),
          delivery('5', { next_attempt_at: new Date(Date.now() + 300_000) }),
        ],
        { autoPauseThreshold: 4, autoPauseBounceRate: 0.05 },
      );
      await ctx.service.dispatchBatch();
      expect(ctx.newsletter.status).toBe('paused');

      const failing = buildDispatcher([delivery('1')]);
      failing.mailer.sendMail.mockRejectedValueOnce(new Error('temporary'));
      await failing.service.dispatchBatch();
      expect(failing.rows[0].status).toBe('pending');
      expect(failing.rows[0].next_attempt_at).toBeInstanceOf(Date);
    });
  });

  describe('NewsletterPlannerService', () => {
    function buildPlanner(
      sendableIds = [1, 2],
      contacts = [
        { id: 1, email: 'a@example.com' },
        { id: 2, email: 'b@example.com' },
      ],
    ) {
      const inserted: any[] = [];
      const newsletters = {
        update: jest.fn(),
        createQueryBuilder: jest.fn(() => ({
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () => ({ targetList: { id: 1, kind: 'static' } })),
        })),
      };
      const service = new NewsletterPlannerService(
        { resolveSendable: jest.fn(async () => sendableIds) } as any,
        {
          filterSendable: jest.fn(async (emails: string[]) =>
            emails.filter((e) => e !== 'bounced@example.com'),
          ),
        } as any,
        newsletters as any,
        { insert: jest.fn(async (rows: any[]) => inserted.push(...rows)) } as any,
        { find: jest.fn(async () => contacts) } as any,
      );
      return { service, inserted, newsletters };
    }

    it('creates pending deliveries, snapshots email, and generates unique tokens', async () => {
      const ctx = buildPlanner();
      await ctx.service.plan({ id: 10 } as any);
      expect(ctx.inserted).toHaveLength(2);
      expect(ctx.inserted[0]).toMatchObject({ status: 'pending', email_at_send: 'a@example.com' });
      expect(new Set(ctx.inserted.map((row) => row.tracking_token)).size).toBe(2);
      expect(ctx.newsletters.update).toHaveBeenCalledWith(10, { summary_total: 2 });
    });

    it('skips opted-out ids before planning and suppressed emails before insert', async () => {
      const ctx = buildPlanner(
        [1, 3],
        [
          { id: 1, email: 'ok@example.com' },
          { id: 3, email: 'bounced@example.com' },
        ],
      );
      await ctx.service.plan({ id: 10 } as any);
      expect(ctx.inserted).toHaveLength(1);
      expect(ctx.inserted[0].email_at_send).toBe('ok@example.com');
    });
  });

  describe('NewsletterTrackerService', () => {
    function buildTracker(row = delivery('1', { status: 'sent' })) {
      const newsletter = {
        id: 1,
        summary_opened: 0,
        summary_clicked: 0,
        summary_bounced: 0,
        summary_complained: 0,
      };
      const newsletters = {
        increment: jest.fn(async (_criteria: any, field: string, amount: number) => {
          newsletter[field] += amount;
        }),
      };
      const deliveries = {
        findOne: jest.fn(async (opts: any) =>
          opts.where.tracking_token === row.tracking_token ? row : null,
        ),
        update: jest.fn(async (_id: any, patch: any) => Object.assign(row, patch)),
      };
      const bounces = { markBounced: jest.fn(), markComplained: jest.fn() };
      return {
        service: new NewsletterTrackerService(
          newsletters as any,
          deliveries as any,
          bounces as any,
        ),
        row,
        newsletter,
        bounces,
      };
    }

    it('records first open once and ignores bounced deliveries', async () => {
      const ctx = buildTracker();
      await ctx.service.recordOpen('token1');
      await ctx.service.recordOpen('token1');
      expect(ctx.newsletter.summary_opened).toBe(1);

      const bounced = buildTracker(delivery('2', { status: 'bounced', tracking_token: 'token2' }));
      await bounced.service.recordOpen('token2');
      expect(bounced.row.opened_at).toBeNull();
    });

    it('records clicks, hard bounces, complaints, and unknown tokens safely', async () => {
      const ctx = buildTracker();
      await ctx.service.recordClick('token1', 'https://example.com');
      await ctx.service.recordClick('token1', 'https://example.com');
      expect(ctx.row.clicks_count).toBe(2);
      expect(ctx.newsletter.summary_clicked).toBe(1);

      await ctx.service.recordBounce('token1', 'hard', 'bad address');
      expect(ctx.row.status).toBe('bounced');
      expect(ctx.bounces.markBounced).toHaveBeenCalledWith(ctx.row.email_at_send);

      const complaint = buildTracker(delivery('3', { tracking_token: 'token3', status: 'sent' }));
      await complaint.service.recordComplaint('token3');
      expect(complaint.row.status).toBe('complained');
      expect(complaint.bounces.markComplained).toHaveBeenCalledWith(complaint.row.email_at_send);

      await expect(ctx.service.recordOpen('unknown')).resolves.toBeUndefined();
    });
  });

  describe('BounceSuppressionStoreService', () => {
    it('stores and filters emails case-insensitively', async () => {
      let row: any = null;
      const settings = {
        findOne: jest.fn(async () => row),
        create: jest.fn((data) => data),
        save: jest.fn(async (data) => {
          row = { id: 1, ...data };
          return row;
        }),
      };
      const store = new BounceSuppressionStoreService(settings as any);
      await store.markBounced('USER@Example.com');
      expect(await store.isBounced('user@example.com')).toBe(true);
      expect(await store.filterSendable(['user@example.com', 'ok@example.com'])).toEqual([
        'ok@example.com',
      ]);
    });
  });

  describe('ContactSegmentResolverService', () => {
    it('resolves static list members and filters opt-outs for sendable ids', async () => {
      const members = { find: jest.fn(async () => [{ contact_id: 1 }, { contact_id: 2 }]) };
      const contacts = {
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          getRawMany: jest.fn(async () => [{ id: 1 }]),
          getCount: jest.fn(async () => 1),
        })),
      };
      const resolver = new ContactSegmentResolverService(contacts as any, members as any);
      expect(await resolver.resolve({ id: 9, kind: 'static' } as any)).toEqual([1, 2]);
      expect(await resolver.resolveSendable({ id: 9, kind: 'static' } as any)).toEqual([1]);
    });
  });
});
