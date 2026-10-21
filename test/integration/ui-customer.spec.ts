import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Department, Reply, SatisfactionRating, Ticket, TicketStatus } from '../../src/entities';
import {
  AGENT,
  apiFetch,
  bootUi,
  cookieFrom,
  CUSTOMER,
  expectManifestProps,
  inertiaFetch,
  page,
} from './ui-harness';

jest.setTimeout(60000);

/**
 * The customer screens over real HTTP and SQLite, with escalated-laravel's
 * Customer\TicketController and CustomerTicketPayload as the prop contract.
 */
describe('customer screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let open: TicketStatus;
  let closed: TicketStatus;
  let billing: Department;
  let seq = 0;

  const asCustomer = { as: 'customer' as const };

  const makeTicket = async (overrides: Partial<Ticket> = {}) => {
    seq += 1;
    return source.getRepository(Ticket).save(
      source.getRepository(Ticket).create({
        referenceNumber: `CUS-${1000 + seq}`,
        subject: `Question ${seq}`,
        description: 'How do I?',
        priority: 'medium',
        channel: 'web',
        statusId: open.id,
        requesterId: CUSTOMER,
        guestAccessToken: `token-${seq}`,
        ...overrides,
      }),
    );
  };

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    const statuses = source.getRepository(TicketStatus);
    open = await statuses.save({ name: 'Open', slug: 'open', isDefault: true });
    closed = await statuses.save({ name: 'Closed', slug: 'closed', isClosed: true });
    billing = await source.getRepository(Department).save({ name: 'Billing', slug: 'billing' });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Escalated/Customer/Index', () => {
    it('lists only the customer’s own tickets, at the prefix root', async () => {
      const mine = await makeTicket({ subject: 'Mine' });
      await makeTicket({ subject: 'Someone else', requesterId: 999 });

      const result = await page(base, '/escalated?search=Mine', asCustomer);
      expect(result.component).toBe('Escalated/Customer/Index');
      expectManifestProps(result);
      expect(result.props.filters).toEqual({ search: 'Mine' });
      expect(result.props.tickets.data.map((t: any) => t.reference)).toEqual([
        mine.referenceNumber,
      ]);
    });

    it('is also served at the customer ticket list, which stays JSON for the API', async () => {
      await makeTicket();
      const screen = await page(base, '/escalated/customer/tickets', asCustomer);
      expect(screen.component).toBe('Escalated/Customer/Index');
      expect(screen.props.tickets.data.every((t: any) => t.requester_id === CUSTOMER)).toBe(true);

      const json = await apiFetch(base, '/escalated/customer/tickets', asCustomer);
      expect(await json.json()).toHaveProperty('total');
    });
  });

  describe('Escalated/Customer/Create', () => {
    it('sends the departments and priorities', async () => {
      const result = await page(base, '/escalated/create', asCustomer);
      expect(result.component).toBe('Escalated/Customer/Create');
      expectManifestProps(result);
      expect(result.props.departments).toContainEqual({ id: billing.id, name: 'Billing' });
      expect(result.props.priorities).toEqual(['low', 'medium', 'high', 'urgent']);
    });

    it('creates the ticket and redirects to it', async () => {
      const res = await inertiaFetch(base, '/escalated', {
        ...asCustomer,
        body: {
          subject: 'Cannot log in',
          description: 'Password reset fails',
          priority: 'high',
          department_id: billing.id,
          ticket_type: 'problem',
          attachments: [],
        },
      });
      expect(res.status).toBe(303);
      const ticket = await source
        .getRepository(Ticket)
        .findOneByOrFail({ subject: 'Cannot log in' });
      expect(ticket).toMatchObject({
        requesterId: CUSTOMER,
        priority: 'high',
        departmentId: billing.id,
        ticketType: 'problem',
        channel: 'web',
      });
      expect(res.headers.get('location')).toBe(
        `/escalated/customer/tickets/${ticket.referenceNumber}`,
      );

      const next = await page(base, res.headers.get('location')!, {
        ...asCustomer,
        headers: { cookie: cookieFrom(res) },
      });
      expect(next.props.flash.success).toBe('Ticket created.');
    });

    it('sends missing fields back as errors', async () => {
      const res = await inertiaFetch(base, '/escalated', {
        ...asCustomer,
        body: { subject: '', description: 'x' },
        headers: { referer: `${base}/escalated/create` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/create');
      const next = await page(base, '/escalated/create', {
        ...asCustomer,
        headers: { cookie: cookieFrom(res) },
      });
      expect(next.props.errors).toEqual({ subject: 'The subject field is required.' });
    });
  });

  describe('Escalated/Customer/Show', () => {
    it('sends the allow-listed ticket without internal notes', async () => {
      const ticket = await makeTicket({ departmentId: billing.id, assigneeId: AGENT });
      const replies = source.getRepository(Reply);
      await replies.save({ ticketId: ticket.id, userId: AGENT, body: 'We replied', type: 'reply' });
      await replies.save({
        ticketId: ticket.id,
        userId: AGENT,
        body: 'secret note',
        type: 'note',
        isInternal: true,
      });

      const result = await page(
        base,
        `/escalated/customer/tickets/${ticket.referenceNumber}`,
        asCustomer,
      );
      expect(result.component).toBe('Escalated/Customer/Show');
      expectManifestProps(result);
      const { ticket: shown } = result.props;
      expect(shown).toMatchObject({
        reference: ticket.referenceNumber,
        status: 'open',
        department: { name: 'Billing' },
        satisfaction_rating: null,
      });
      expect(shown.replies.map((r: any) => r.body)).toEqual(['We replied']);
      expect(JSON.stringify(shown)).not.toContain('secret note');
      expect(shown).not.toHaveProperty('assignee');
      expect(shown).not.toHaveProperty('guestAccessToken');
    });

    it('refuses another customer’s ticket', async () => {
      const ticket = await makeTicket({ requesterId: 999 });
      const res = await inertiaFetch(
        base,
        `/escalated/customer/tickets/${ticket.referenceNumber}`,
        asCustomer,
      );
      expect(res.status).toBe(403);
    });
  });

  describe('actions the ticket screen posts', () => {
    const act = async (ticket: Ticket, action: string, body: unknown = {}) => {
      const show = `/escalated/customer/tickets/${ticket.referenceNumber}`;
      const res = await inertiaFetch(base, `${show}/${action}`, {
        ...asCustomer,
        body,
        headers: { referer: `${base}${show}` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(show);
      return source.getRepository(Ticket).findOneByOrFail({ id: ticket.id });
    };

    it('replies', async () => {
      const ticket = await makeTicket();
      await act(ticket, 'reply', { body: 'Any news?', is_internal_note: true });
      const reply = await source.getRepository(Reply).findOneByOrFail({ ticketId: ticket.id });
      expect(reply).toMatchObject({ body: 'Any news?', isInternal: false, userId: CUSTOMER });
    });

    it('closes and reopens', async () => {
      const ticket = await makeTicket();
      expect((await act(ticket, 'close')).statusId).toBe(closed.id);
      expect((await act(ticket, 'reopen')).statusId).toBe(open.id);
    });

    it('rates a resolved ticket by reference', async () => {
      const ticket = await makeTicket({ statusId: closed.id });
      await act(ticket, 'rate', { rating: 5, comment: 'Great' });
      expect(
        await source.getRepository(SatisfactionRating).findOneByOrFail({ ticketId: ticket.id }),
      ).toMatchObject({ rating: 5, comment: 'Great', customerId: CUSTOMER });
    });

    it('cannot act on another customer’s ticket', async () => {
      const ticket = await makeTicket({ requesterId: 999 });
      const res = await inertiaFetch(
        base,
        `/escalated/customer/tickets/${ticket.referenceNumber}/reply`,
        { ...asCustomer, body: { body: 'hijack' } },
      );
      expect(res.status).toBe(403);
      expect(await source.getRepository(Reply).countBy({ ticketId: ticket.id })).toBe(0);
    });
  });
});
