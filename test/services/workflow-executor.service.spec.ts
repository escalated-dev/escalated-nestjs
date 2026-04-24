import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ticket } from '../../src/entities/ticket.entity';
import { TicketStatus } from '../../src/entities/ticket-status.entity';
import { Tag } from '../../src/entities/tag.entity';
import { TicketActivity } from '../../src/entities/ticket-activity.entity';
import { Reply } from '../../src/entities/reply.entity';
import { WorkflowExecutorService } from '../../src/services/workflow-executor.service';
import { WorkflowEngineService } from '../../src/services/workflow-engine.service';
import { buildTicket } from '../factories';

describe('WorkflowExecutorService', () => {
  let executor: WorkflowExecutorService;
  let ticketRepo: any;
  let statusRepo: any;
  let tagRepo: any;
  let activityRepo: any;
  let replyRepo: any;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    ticketRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
      save: jest.fn(async (x) => x),
    };
    statusRepo = {
      findOne: jest.fn(),
    };
    tagRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    activityRepo = {
      save: jest.fn(async (x) => ({ id: 1, ...x })),
    };
    replyRepo = {
      save: jest.fn(async (x) => ({ id: 1, ...x })),
    };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowExecutorService,
        WorkflowEngineService,
        { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketStatus), useValue: statusRepo },
        { provide: getRepositoryToken(Tag), useValue: tagRepo },
        { provide: getRepositoryToken(TicketActivity), useValue: activityRepo },
        { provide: getRepositoryToken(Reply), useValue: replyRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    executor = module.get(WorkflowExecutorService);
  });

  describe('change_priority', () => {
    it('updates the ticket priority', async () => {
      const ticket = buildTicket({ id: 10, priority: 'medium' }) as unknown as Ticket;
      await executor.execute(ticket, [{ type: 'change_priority', value: 'urgent' }]);
      expect(ticketRepo.update).toHaveBeenCalledWith(10, { priority: 'urgent' });
    });
  });

  describe('add_tag', () => {
    it('attaches the tag to the ticket when the tag exists (by slug)', async () => {
      const ticket = buildTicket({ id: 10, tags: [] }) as unknown as Ticket;
      const tag = { id: 7, name: 'VIP', slug: 'vip' };
      tagRepo.findOne.mockResolvedValue(tag);
      ticketRepo.findOne.mockResolvedValue({ ...ticket, tags: [] });

      await executor.execute(ticket, [{ type: 'add_tag', value: 'vip' }]);

      expect(tagRepo.findOne).toHaveBeenCalledWith({ where: { slug: 'vip' } });
      expect(ticketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tags: expect.arrayContaining([tag]) }),
      );
    });

    it('falls back to lookup by id when value is numeric', async () => {
      const ticket = buildTicket({ id: 10, tags: [] }) as unknown as Ticket;
      const tag = { id: 7, name: 'VIP', slug: 'vip' };
      tagRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(tag);
      ticketRepo.findOne.mockResolvedValue({ ...ticket, tags: [] });

      await executor.execute(ticket, [{ type: 'add_tag', value: '7' }]);

      expect(tagRepo.findOne).toHaveBeenNthCalledWith(1, { where: { slug: '7' } });
      expect(tagRepo.findOne).toHaveBeenNthCalledWith(2, { where: { id: 7 } });
    });

    it('is a no-op when tag not found', async () => {
      const ticket = buildTicket({ id: 10, tags: [] }) as unknown as Ticket;
      tagRepo.findOne.mockResolvedValue(null);

      await executor.execute(ticket, [{ type: 'add_tag', value: 'missing' }]);

      expect(ticketRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove_tag', () => {
    it('detaches the tag from the ticket', async () => {
      const tag = { id: 7, name: 'VIP', slug: 'vip' };
      const ticket = buildTicket({ id: 10, tags: [tag] }) as unknown as Ticket;
      tagRepo.findOne.mockResolvedValue(tag);
      ticketRepo.findOne.mockResolvedValue({ ...ticket, tags: [tag] });

      await executor.execute(ticket, [{ type: 'remove_tag', value: 'vip' }]);

      expect(ticketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tags: [] }),
      );
    });
  });

  describe('assign_agent', () => {
    it('sets assigneeId and writes an activity log', async () => {
      const ticket = buildTicket({ id: 10, assigneeId: null }) as unknown as Ticket;
      await executor.execute(ticket, [{ type: 'assign_agent', value: '5' }]);

      expect(ticketRepo.update).toHaveBeenCalledWith(10, { assigneeId: 5 });
      expect(activityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 10,
          action: 'assigned',
        }),
      );
    });

    it('emits TICKET_ASSIGNED event', async () => {
      const ticket = buildTicket({ id: 10, assigneeId: null }) as unknown as Ticket;
      await executor.execute(ticket, [{ type: 'assign_agent', value: '5' }]);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'escalated.ticket.assigned',
        expect.anything(),
      );
    });
  });

  describe('change_status', () => {
    it('sets statusId by looking up status via slug', async () => {
      const ticket = buildTicket({ id: 10, statusId: 1 }) as unknown as Ticket;
      statusRepo.findOne.mockResolvedValue({ id: 2, slug: 'resolved' });

      await executor.execute(ticket, [{ type: 'change_status', value: 'resolved' }]);

      expect(statusRepo.findOne).toHaveBeenCalledWith({ where: { slug: 'resolved' } });
      expect(ticketRepo.update).toHaveBeenCalledWith(10, { statusId: 2 });
    });

    it('accepts numeric status id directly', async () => {
      const ticket = buildTicket({ id: 10, statusId: 1 }) as unknown as Ticket;
      statusRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3 });

      await executor.execute(ticket, [{ type: 'change_status', value: '3' }]);

      expect(statusRepo.findOne).toHaveBeenNthCalledWith(1, { where: { slug: '3' } });
      expect(statusRepo.findOne).toHaveBeenNthCalledWith(2, { where: { id: 3 } });
    });

    it('is a no-op when status not found', async () => {
      const ticket = buildTicket({ id: 10 }) as unknown as Ticket;
      statusRepo.findOne.mockResolvedValue(null);

      await executor.execute(ticket, [{ type: 'change_status', value: 'nonsense' }]);

      expect(ticketRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('set_department', () => {
    it('updates the ticket departmentId', async () => {
      const ticket = buildTicket({ id: 10 }) as unknown as Ticket;
      await executor.execute(ticket, [{ type: 'set_department', value: '4' }]);
      expect(ticketRepo.update).toHaveBeenCalledWith(10, { departmentId: 4 });
    });
  });

  describe('add_note', () => {
    it('creates an internal reply on the ticket', async () => {
      const ticket = buildTicket({ id: 10 }) as unknown as Ticket;
      await executor.execute(ticket, [{ type: 'add_note', value: 'auto-note' }]);

      expect(replyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 10,
          body: 'auto-note',
          type: 'note',
          isInternal: true,
        }),
      );
    });
  });

  describe('insert_canned_reply', () => {
    it('creates an external reply with template interpolated against the ticket', async () => {
      const ticket = buildTicket({
        id: 10,
        subject: 'My laptop',
        priority: 'urgent',
      }) as unknown as Ticket;

      await executor.execute(ticket, [
        {
          type: 'insert_canned_reply',
          value: 'Hi! About {{subject}} (priority: {{priority}}) — on it.',
        },
      ]);

      expect(replyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 10,
          body: 'Hi! About My laptop (priority: urgent) — on it.',
          type: 'reply',
          isInternal: false,
        }),
      );
    });

    it('leaves unknown variables untouched', async () => {
      const ticket = buildTicket({ id: 10, subject: 'Hi' }) as unknown as Ticket;

      await executor.execute(ticket, [
        { type: 'insert_canned_reply', value: 'Hello {{nonexistent}}' },
      ]);

      expect(replyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Hello {{nonexistent}}' }),
      );
    });
  });

  describe('dispatch', () => {
    it('runs all actions in order', async () => {
      const ticket = buildTicket({ id: 10 }) as unknown as Ticket;
      await executor.execute(ticket, [
        { type: 'change_priority', value: 'high' },
        { type: 'set_department', value: '2' },
      ]);
      expect(ticketRepo.update).toHaveBeenNthCalledWith(1, 10, { priority: 'high' });
      expect(ticketRepo.update).toHaveBeenNthCalledWith(2, 10, { departmentId: 2 });
    });

    it('throws on unknown action type', async () => {
      const ticket = buildTicket({ id: 10 }) as unknown as Ticket;
      await expect(
        executor.execute(ticket, [{ type: 'nonsense' }]),
      ).rejects.toThrow(/Unknown workflow action/);
    });
  });
});
