import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { TicketSubjectService } from '../../src/services/ticket-subject.service';
import { TicketSubjectLink } from '../../src/entities/ticket-subject-link.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { TicketSubject } from '../../src/contracts/ticket-subject.interface';
import { ESCALATED_OPTIONS } from '../../src/config/escalated.config';

const SUBJECT_TYPE = 'FakeProject';

class FakePresentable implements TicketSubject {
  constructor(
    private readonly title: string,
    private readonly id: string,
  ) {}

  ticketSubjectTitle(): string {
    return this.title;
  }

  ticketSubjectSubtitle(): string | null {
    return `Project · Acme`;
  }

  ticketSubjectUrl(): string | null {
    return `https://app.test/projects/${this.id}`;
  }

  ticketSubjectColor(): string | null {
    return '#2563eb';
  }

  ticketSubjectIcon(): string | null {
    return 'folder';
  }
}

describe('TicketSubjectService', () => {
  let service: TicketSubjectService;
  let linkRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const ticket = { id: 1 } as Ticket;

  const makeModule = async (options: {
    types?: string[];
    resolver?: (type: string, id: string) => Promise<TicketSubject | null>;
  }) => {
    linkRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (data) => ({
        id: data.id ?? 1,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      remove: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: -1 }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketSubjectService,
        {
          provide: getRepositoryToken(TicketSubjectLink),
          useValue: linkRepo,
        },
        {
          provide: ESCALATED_OPTIONS,
          useValue: {
            ticketSubjects: {
              types: options.types ?? [SUBJECT_TYPE],
              resolver: options.resolver,
            },
          },
        },
      ],
    }).compile();

    service = module.get(TicketSubjectService);
  };

  beforeEach(async () => {
    await makeModule({});
  });

  it('attaches a subject, preserving a string id', async () => {
    const link = await service.attach(ticket, SUBJECT_TYPE, 'prj_9f1c', 'project');

    expect(link.subjectType).toBe(SUBJECT_TYPE);
    expect(link.subjectId).toBe('prj_9f1c');
    expect(link.role).toBe('project');
    expect(linkRepo.save).toHaveBeenCalled();
  });

  it('is idempotent on ticket+type+id and updates the role', async () => {
    const existing = {
      id: 5,
      ticketId: 1,
      subjectType: SUBJECT_TYPE,
      subjectId: 'p1',
      role: null,
      position: 0,
    };
    linkRepo.findOne.mockResolvedValue(existing);

    const link = await service.attach(ticket, SUBJECT_TYPE, 'p1', 'account');

    expect(link.role).toBe('account');
    expect(linkRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 5, role: 'account' }));
    expect(linkRepo.save).toHaveBeenCalledTimes(1);
  });

  it('detaches by link id', async () => {
    linkRepo.findOne.mockResolvedValue({
      id: 9,
      ticketId: 1,
      subjectType: SUBJECT_TYPE,
      subjectId: '1',
    });

    await service.detach(ticket, 9);

    expect(linkRepo.remove).toHaveBeenCalled();
  });

  it('syncs subjects, replacing existing and preserving order', async () => {
    await service.sync(ticket, [
      { subjectType: SUBJECT_TYPE, subjectId: 'b', role: 'primary' },
      { subjectType: SUBJECT_TYPE, subjectId: 'c' },
    ]);

    expect(linkRepo.delete).toHaveBeenCalledWith({ ticketId: 1 });
    expect(linkRepo.save).toHaveBeenCalledTimes(2);
    expect(linkRepo.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ subjectId: 'b', role: 'primary', position: 0 }),
    );
    expect(linkRepo.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ subjectId: 'c', position: 1 }),
    );
  });

  it('rejects attaching a type outside the configured allowlist', async () => {
    await expect(service.attach(ticket, 'OtherType', '1')).rejects.toThrow(BadRequestException);
  });

  it('allows any type programmatically when no allowlist is configured', async () => {
    await makeModule({ types: [] });

    const link = await service.attach(ticket, SUBJECT_TYPE, '1');

    expect(link.subjectId).toBe('1');
  });

  it('serializes subjects through a resolver', async () => {
    await makeModule({
      types: [SUBJECT_TYPE],
      resolver: async (_type, id) => new FakePresentable('Acme Redesign', id),
    });

    const links = [
      {
        id: 1,
        ticketId: 1,
        subjectType: SUBJECT_TYPE,
        subjectId: '7',
        role: 'project',
        position: 0,
      } as TicketSubjectLink,
    ];

    const serialized = await service.serializeLinks(links);

    expect(serialized).toHaveLength(1);
    expect(serialized[0]).toMatchObject({
      type: SUBJECT_TYPE,
      id: '7',
      role: 'project',
      title: 'Acme Redesign',
      subtitle: 'Project · Acme',
      url: 'https://app.test/projects/7',
      color: '#2563eb',
      icon: 'folder',
      missing: false,
    });
  });

  it('falls back when the resolver is absent or returns null', async () => {
    await makeModule({ types: [SUBJECT_TYPE], resolver: async () => null });

    const serialized = await service.serializeLinks([
      {
        subjectType: SUBJECT_TYPE,
        subjectId: '99',
        role: null,
      } as TicketSubjectLink,
    ]);

    expect(serialized[0]).toMatchObject({
      title: `${SUBJECT_TYPE}#99`,
      subtitle: null,
      url: null,
      color: null,
      icon: null,
      missing: true,
    });
  });
});
