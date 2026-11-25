import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Ticket, TicketStatus, TicketSubjectLink } from '../../src/entities';
import { apiFetch, bootUi, CUSTOMER, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * The host records a ticket is about ("subjects", the sidebar's Related card)
 * on both staff ticket screens, `Escalated/Agent/TicketShow` and
 * `Escalated/Admin/Tickets/Show`, serialised exactly as the agent JSON API
 * sends them.
 */
describe('ticket subjects on the staff ticket screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let ticket: Ticket;

  const expected = [
    {
      type: 'order',
      id: '42',
      role: 'primary',
      title: 'Order #42',
      subtitle: 'Paid',
      url: 'https://shop.example.com/orders/42',
      color: '#0a0',
      icon: 'cart',
      missing: false,
    },
    {
      type: 'order',
      id: '404',
      role: null,
      title: 'order#404',
      subtitle: null,
      url: null,
      color: null,
      icon: null,
      missing: true,
    },
  ];

  beforeAll(async () => {
    ({ app, source, base } = await bootUi({
      ticketSubjects: {
        types: ['order'],
        resolver: async (type, id) =>
          type === 'order' && id === '42'
            ? {
                ticketSubjectTitle: () => 'Order #42',
                ticketSubjectSubtitle: () => 'Paid',
                ticketSubjectUrl: () => 'https://shop.example.com/orders/42',
                ticketSubjectColor: () => '#0a0',
                ticketSubjectIcon: () => 'cart',
              }
            : null,
      },
    }));
    const open = await source
      .getRepository(TicketStatus)
      .save({ name: 'Open', slug: 'open', isDefault: true });
    ticket = await source.getRepository(Ticket).save(
      source.getRepository(Ticket).create({
        referenceNumber: 'SUB-1001',
        subject: 'Where is my order?',
        description: 'It has not arrived',
        priority: 'medium',
        channel: 'web',
        statusId: open.id,
        requesterId: CUSTOMER,
        guestAccessToken: 'subjects-token',
      }),
    );
    await source.getRepository(TicketSubjectLink).save([
      { ticketId: ticket.id, subjectType: 'order', subjectId: '42', role: 'primary', position: 0 },
      { ticketId: ticket.id, subjectType: 'order', subjectId: '404', role: null, position: 1 },
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sends the subjects the agent JSON API sends', async () => {
    const res = await apiFetch(base, `/escalated/agent/tickets/${ticket.id}`, { as: 'agent' });
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.subjects).toEqual(expected);
  });

  it('includes ticket.subjects on Escalated/Agent/TicketShow', async () => {
    const result = await page(base, `/escalated/agent/tickets/${ticket.referenceNumber}`, {
      as: 'agent',
    });
    expect(result.component).toBe('Escalated/Agent/TicketShow');
    expect(result.props.ticket.subjects).toEqual(expected);
  });

  it('includes ticket.subjects on Escalated/Admin/Tickets/Show', async () => {
    const result = await page(base, `/escalated/admin/tickets/${ticket.referenceNumber}`, {
      as: 'admin',
    });
    expect(result.component).toBe('Escalated/Admin/Tickets/Show');
    expect(result.props.ticket.subjects).toEqual(expected);
  });
});
