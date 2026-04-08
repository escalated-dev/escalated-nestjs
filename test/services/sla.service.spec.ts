import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaService } from '../../src/services/sla.service';
import { SlaPolicy } from '../../src/entities/sla-policy.entity';
import { BusinessSchedule } from '../../src/entities/business-schedule.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { ESCALATED_EVENTS } from '../../src/events/escalated.events';

describe('SlaService', () => {
  let service: SlaService;
  let slaPolicyRepo: any;
  let ticketRepo: any;
  let eventEmitter: EventEmitter2;

  const mockPolicy: Partial<SlaPolicy> = {
    id: 1,
    name: 'Default SLA',
    isActive: true,
    isDefault: true,
    firstResponseLow: 60,
    firstResponseMedium: 30,
    firstResponseHigh: 15,
    firstResponseUrgent: 5,
    resolutionLow: 1440,
    resolutionMedium: 480,
    resolutionHigh: 240,
    resolutionUrgent: 60,
    conditions: null,
    businessScheduleId: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaService,
        {
          provide: getRepositoryToken(SlaPolicy),
          useValue: {
            find: jest.fn().mockResolvedValue([mockPolicy]),
            findOne: jest.fn().mockResolvedValue(mockPolicy),
            create: jest.fn().mockReturnValue(mockPolicy),
            save: jest.fn().mockResolvedValue(mockPolicy),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockPolicy),
          },
        },
        {
          provide: getRepositoryToken(BusinessSchedule),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: getRepositoryToken(Ticket),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SlaService>(SlaService);
    slaPolicyRepo = module.get(getRepositoryToken(SlaPolicy));
    ticketRepo = module.get(getRepositoryToken(Ticket));
    eventEmitter = module.get(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all SLA policies', async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should create an SLA policy', async () => {
      const result = await service.create({ name: 'New Policy' });
      expect(slaPolicyRepo.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('applyToTicket', () => {
    it('should apply SLA to a ticket', async () => {
      const ticket = { id: 1, priority: 'medium' } as Ticket;
      await service.applyToTicket(ticket);

      expect(ticketRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          slaPolicyId: 1,
          firstResponseDueAt: expect.any(Date),
          resolutionDueAt: expect.any(Date),
        }),
      );
    });
  });

  describe('checkBreaches', () => {
    it('should detect first response breaches', async () => {
      const breachedTicket = {
        id: 1,
        firstResponseDueAt: new Date(Date.now() - 10000),
        firstRespondedAt: null,
        slaBreached: false,
      };
      ticketRepo.find.mockResolvedValueOnce([breachedTicket]).mockResolvedValueOnce([]);

      await service.checkBreaches();

      expect(ticketRepo.update).toHaveBeenCalledWith(1, { slaBreached: true });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ESCALATED_EVENTS.SLA_BREACHED,
        expect.objectContaining({ breachType: 'first_response' }),
      );
    });
  });

  describe('addBusinessMinutes', () => {
    it('should add minutes within business hours', () => {
      const schedule = {
        schedule: {
          monday: { start: '09:00', end: '17:00', enabled: true },
          tuesday: { start: '09:00', end: '17:00', enabled: true },
          wednesday: { start: '09:00', end: '17:00', enabled: true },
          thursday: { start: '09:00', end: '17:00', enabled: true },
          friday: { start: '09:00', end: '17:00', enabled: true },
          saturday: { start: '09:00', end: '17:00', enabled: false },
          sunday: { start: '09:00', end: '17:00', enabled: false },
        },
      } as BusinessSchedule;

      // Monday at 10:00, add 30 minutes = Monday at 10:30
      const start = new Date('2024-01-15T10:00:00');
      const result = service.addBusinessMinutes(start, 30, schedule);

      expect(result.getHours()).toBe(10);
      expect(result.getMinutes()).toBe(30);
    });
  });
});
