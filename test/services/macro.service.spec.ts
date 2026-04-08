import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MacroService } from '../../src/services/macro.service';
import { Macro } from '../../src/entities/macro.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { Reply } from '../../src/entities/reply.entity';

describe('MacroService', () => {
  let service: MacroService;
  let macroRepo: any;
  let ticketRepo: any;
  let replyRepo: any;

  const mockMacro = {
    id: 1,
    name: 'Close and Reply',
    actions: [
      { type: 'set_status', value: 3 },
      { type: 'add_reply', value: 'Thank you for contacting us!' },
    ],
    scope: 'shared',
    isActive: true,
    usageCount: 0,
  };

  const mockTicket = {
    id: 1,
    referenceNumber: 'TK-ABC',
    statusId: 1,
    status: { id: 1, name: 'Open' },
    tags: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MacroService,
        {
          provide: getRepositoryToken(Macro),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockMacro),
            create: jest.fn().mockReturnValue(mockMacro),
            save: jest.fn().mockResolvedValue(mockMacro),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockMacro),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([mockMacro]),
            }),
          },
        },
        {
          provide: getRepositoryToken(Ticket),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockTicket),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(Reply),
          useValue: {
            save: jest.fn().mockResolvedValue({ id: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<MacroService>(MacroService);
    macroRepo = module.get(getRepositoryToken(Macro));
    ticketRepo = module.get(getRepositoryToken(Ticket));
    replyRepo = module.get(getRepositoryToken(Reply));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return macros', async () => {
      const result = await service.findAll(1);
      expect(result).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('should execute all macro actions on a ticket', async () => {
      await service.execute(1, 1, 1);

      // set_status action
      expect(ticketRepo.update).toHaveBeenCalledWith(1, { statusId: 3 });
      // add_reply action
      expect(replyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 1,
          body: 'Thank you for contacting us!',
        }),
      );
      // Usage count increment
      expect(macroRepo.update).toHaveBeenCalled();
    });

    it('should throw for missing ticket', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      await expect(service.execute(1, 999, 1)).rejects.toThrow('not found');
    });
  });
});
