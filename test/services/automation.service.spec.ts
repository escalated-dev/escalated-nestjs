import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AutomationService } from '../../src/services/automation.service';
import { Automation } from '../../src/entities/automation.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { Tag } from '../../src/entities/tag.entity';
import { Reply } from '../../src/entities/reply.entity';

describe('AutomationService', () => {
  let service: AutomationService;
  let automationRepo: any;
  let ticketRepo: any;
  let tagRepo: any;
  let replyRepo: any;

  let qbState: { whereCalls: string[]; params: Record<string, any>; matched: any[] };

  function makeQb() {
    return {
      where: jest.fn(function (sql: string) {
        qbState.whereCalls.push(sql);
        return this;
      }),
      andWhere: jest.fn(function (sql: string, params?: Record<string, any>) {
        qbState.whereCalls.push(sql);
        if (params) Object.assign(qbState.params, params);
        return this;
      }),
      getMany: jest.fn().mockImplementation(() => Promise.resolve(qbState.matched)),
    };
  }

  beforeEach(async () => {
    qbState = { whereCalls: [], params: {}, matched: [] };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationService,
        {
          provide: getRepositoryToken(Automation),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            create: jest.fn((d) => d),
            save: jest.fn((d) => Promise.resolve({ id: 1, ...d })),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(Ticket),
          useValue: {
            createQueryBuilder: jest.fn(() => makeQb()),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            findOne: jest.fn(),
            save: jest.fn((t) => Promise.resolve(t)),
          },
        },
        {
          provide: getRepositoryToken(Tag),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(Reply),
          useValue: {
            create: jest.fn((d) => d),
            save: jest.fn((d) => Promise.resolve({ id: 99, ...d })),
          },
        },
      ],
    }).compile();

    service = module.get<AutomationService>(AutomationService);
    automationRepo = module.get(getRepositoryToken(Automation));
    ticketRepo = module.get(getRepositoryToken(Ticket));
    tagRepo = module.get(getRepositoryToken(Tag));
    replyRepo = module.get(getRepositoryToken(Reply));
  });

  describe('CRUD', () => {
    it('findAll orders by position then id', async () => {
      automationRepo.find.mockResolvedValue([{ id: 2 }, { id: 1 }]);
      await service.findAll();
      expect(automationRepo.find).toHaveBeenCalledWith({
        order: { position: 'ASC', id: 'ASC' },
      });
    });

    it('findById throws NotFoundException when missing', async () => {
      automationRepo.findOne.mockResolvedValue(null);
      await expect(service.findById(404)).rejects.toThrow('Automation #404 not found');
    });

    it('create persists via create+save', async () => {
      const result = await service.create({ name: 'X', conditions: [], actions: [] });
      expect(automationRepo.create).toHaveBeenCalled();
      expect(automationRepo.save).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('update calls findById then update', async () => {
      automationRepo.findOne.mockResolvedValue({ id: 1, name: 'X' });
      await service.update(1, { name: 'Y' });
      expect(automationRepo.update).toHaveBeenCalledWith(1, { name: 'Y' });
    });

    it('delete removes after findById succeeds', async () => {
      automationRepo.findOne.mockResolvedValue({ id: 1 });
      await service.delete(1);
      expect(automationRepo.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('findMatchingTickets (via run)', () => {
    it('flips operator on hours_since_created (> hours = older datetime)', async () => {
      automationRepo.find.mockResolvedValue([
        {
          id: 1,
          name: 'auto-close stale',
          conditions: [{ field: 'hours_since_created', operator: '>', value: 48 }],
          actions: [],
        },
      ]);

      await service.run();

      expect(qbState.whereCalls.some((s) => s.includes('ticket.createdAt <'))).toBe(true);
      expect(qbState.params.hsc).toBeInstanceOf(Date);
    });

    it('only scans non-resolved/closed tickets via timestamp checks', async () => {
      automationRepo.find.mockResolvedValue([{ id: 1, name: 'x', conditions: [], actions: [] }]);

      await service.run();

      expect(qbState.whereCalls).toContain('ticket.resolvedAt IS NULL');
      expect(qbState.whereCalls).toContain('ticket.closedAt IS NULL');
    });

    it('handles assigned: unassigned by adding IS NULL clause', async () => {
      automationRepo.find.mockResolvedValue([
        {
          id: 1,
          name: 'x',
          conditions: [{ field: 'assigned', operator: '=', value: 'unassigned' }],
          actions: [],
        },
      ]);

      await service.run();

      expect(qbState.whereCalls).toContain('ticket.assigneeId IS NULL');
    });

    it('skips unknown fields silently (forward-compat)', async () => {
      automationRepo.find.mockResolvedValue([
        {
          id: 1,
          name: 'x',
          conditions: [{ field: 'something_new', operator: '>', value: 5 }],
          actions: [],
        },
      ]);

      await service.run();

      expect(qbState.whereCalls.some((s) => s.includes('something_new'))).toBe(false);
    });
  });

  describe('executeActions (via run)', () => {
    it('change_status calls ticket update with statusId numeric value', async () => {
      qbState.matched = [{ id: 7 }];
      automationRepo.find.mockResolvedValue([
        {
          id: 1,
          name: 'close',
          conditions: [],
          actions: [{ type: 'change_status', value: 5 }],
        },
      ]);

      const affected = await service.run();

      expect(affected).toBe(1);
      expect(ticketRepo.update).toHaveBeenCalledWith(7, { statusId: 5 });
    });

    it('add_note creates an internal note with system_note metadata', async () => {
      qbState.matched = [{ id: 7 }];
      automationRepo.find.mockResolvedValue([
        {
          id: 11,
          name: 'note',
          conditions: [],
          actions: [{ type: 'add_note', value: 'auto-flagged stale' }],
        },
      ]);

      await service.run();

      expect(replyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 7,
          isInternalNote: true,
          metadata: expect.objectContaining({ system_note: true, automation_id: 11 }),
        }),
      );
      expect(replyRepo.save).toHaveBeenCalled();
    });

    it('add_tag is a no-op when tag does not exist', async () => {
      qbState.matched = [{ id: 7 }];
      tagRepo.findOne.mockResolvedValue(null);
      automationRepo.find.mockResolvedValue([
        {
          id: 1,
          name: 'tag',
          conditions: [],
          actions: [{ type: 'add_tag', value: 'nonexistent' }],
        },
      ]);

      await service.run();

      expect(ticketRepo.save).not.toHaveBeenCalled();
    });

    it('one bad action does not abort the rest', async () => {
      qbState.matched = [{ id: 7 }];
      // First update throws, second should still run
      ticketRepo.update
        .mockImplementationOnce(() => Promise.reject(new Error('boom')))
        .mockImplementationOnce(() => Promise.resolve({ affected: 1 }));

      automationRepo.find.mockResolvedValue([
        {
          id: 1,
          name: 'multi',
          conditions: [],
          actions: [
            { type: 'change_status', value: 'pending' },
            { type: 'change_priority', value: 'high' },
          ],
        },
      ]);

      await service.run();

      expect(ticketRepo.update).toHaveBeenCalledTimes(2);
      expect(ticketRepo.update).toHaveBeenLastCalledWith(7, { priority: 'high' });
    });

    it('updates lastRunAt after each automation regardless of match count', async () => {
      qbState.matched = [];
      automationRepo.find.mockResolvedValue([
        { id: 5, name: 'no-matches', conditions: [], actions: [] },
      ]);

      await service.run();

      expect(automationRepo.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ lastRunAt: expect.any(Date) }),
      );
    });

    it('one failing automation does not abort sibling automations', async () => {
      automationRepo.find.mockResolvedValue([
        { id: 1, name: 'fails', conditions: [], actions: [] },
        { id: 2, name: 'works', conditions: [], actions: [] },
      ]);

      // Force the first automation's findMatchingTickets to throw by
      // making the QB getMany reject only on first call.
      let qbCalls = 0;
      ticketRepo.createQueryBuilder.mockImplementation(() => {
        const qb = makeQb();
        if (qbCalls++ === 0) qb.getMany = jest.fn().mockRejectedValue(new Error('boom'));
        return qb;
      });

      await service.run();

      // Both automations attempted; only the second updates lastRunAt
      expect(automationRepo.update).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ lastRunAt: expect.any(Date) }),
      );
      expect(automationRepo.update).not.toHaveBeenCalledWith(
        1,
        expect.objectContaining({ lastRunAt: expect.any(Date) }),
      );
    });
  });
});
