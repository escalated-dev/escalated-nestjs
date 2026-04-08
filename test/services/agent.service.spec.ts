import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentService } from '../../src/services/agent.service';
import { AgentProfile } from '../../src/entities/agent-profile.entity';
import { AgentCapacity } from '../../src/entities/agent-capacity.entity';
import { Skill } from '../../src/entities/skill.entity';
import { Ticket } from '../../src/entities/ticket.entity';

describe('AgentService', () => {
  let service: AgentService;
  let profileRepo: any;
  let capacityRepo: any;
  let ticketRepo: any;

  const mockProfile = {
    id: 1,
    userId: 10,
    displayName: 'Agent Smith',
    isActive: true,
    isAvailable: true,
    skills: [],
    departments: [],
  };

  const mockCapacity = {
    id: 1,
    agentProfileId: 1,
    maxTickets: 20,
    currentTickets: 5,
    maxUrgent: 5,
    currentUrgent: 1,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        {
          provide: getRepositoryToken(AgentProfile),
          useValue: {
            find: jest.fn().mockResolvedValue([mockProfile]),
            findOne: jest.fn().mockResolvedValue(mockProfile),
            create: jest.fn().mockReturnValue(mockProfile),
            save: jest.fn().mockResolvedValue(mockProfile),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockProfile),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              leftJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(mockProfile),
            }),
          },
        },
        {
          provide: getRepositoryToken(AgentCapacity),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockCapacity),
            save: jest.fn().mockResolvedValue(mockCapacity),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(Skill),
          useValue: {
            findBy: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(Ticket),
          useValue: {
            count: jest.fn().mockResolvedValue(5),
          },
        },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
    profileRepo = module.get(getRepositoryToken(AgentProfile));
    capacityRepo = module.get(getRepositoryToken(AgentCapacity));
    ticketRepo = module.get(getRepositoryToken(Ticket));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all agents', async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should create agent profile with capacity', async () => {
      await service.create({ userId: 10, displayName: 'New Agent' });

      expect(profileRepo.save).toHaveBeenCalled();
      expect(capacityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ maxTickets: 20 }),
      );
    });
  });

  describe('getCapacity', () => {
    it('should return agent capacity', async () => {
      const result = await service.getCapacity(1);
      expect(result).toEqual(mockCapacity);
    });
  });

  describe('recalculateCapacity', () => {
    it('should update capacity from actual ticket counts', async () => {
      await service.recalculateCapacity(1);

      expect(ticketRepo.count).toHaveBeenCalled();
      expect(capacityRepo.update).toHaveBeenCalled();
    });
  });

  describe('findAvailableAgent', () => {
    it('should find an available agent', async () => {
      const result = await service.findAvailableAgent();
      expect(result).toBeDefined();
    });
  });
});
