import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SkillService } from '../../src/services/skill.service';
import { Skill } from '../../src/entities/skill.entity';
import { AgentSkill } from '../../src/entities/agent-skill.entity';
import { Tag } from '../../src/entities/tag.entity';
import { Department } from '../../src/entities/department.entity';
import { AgentProfile } from '../../src/entities/agent-profile.entity';

describe('SkillService', () => {
  let service: SkillService;
  let skillRepo: any;
  let agentSkillRepo: any;
  let tagRepo: any;
  let departmentRepo: any;

  const baseSkill = {
    id: 1,
    name: 'Networking',
    slug: 'networking',
    description: null,
    routingTags: [],
    routingDepartments: [],
    agentSkills: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillService,
        {
          provide: getRepositoryToken(Skill),
          useValue: {
            find: jest.fn().mockResolvedValue([baseSkill]),
            findOne: jest.fn().mockResolvedValue(baseSkill),
            findBy: jest.fn().mockResolvedValue([]),
            create: jest.fn((data) => ({ ...data, id: 2 })),
            save: jest.fn(async (entity) => ({ ...baseSkill, ...entity, id: 2 })),
            remove: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(AgentSkill),
          useValue: {
            create: jest.fn((row) => row),
            save: jest.fn().mockResolvedValue([]),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
          },
        },
        {
          provide: getRepositoryToken(Tag),
          useValue: {
            find: jest.fn().mockResolvedValue([{ id: 1, name: 'bug' }]),
            findBy: jest.fn().mockResolvedValue([{ id: 1, name: 'bug' }]),
          },
        },
        {
          provide: getRepositoryToken(Department),
          useValue: {
            find: jest.fn().mockResolvedValue([{ id: 1, name: 'Support' }]),
            findBy: jest.fn().mockResolvedValue([{ id: 1, name: 'Support' }]),
          },
        },
        {
          provide: getRepositoryToken(AgentProfile),
          useValue: {
            find: jest
              .fn()
              .mockResolvedValue([{ userId: 42, displayName: 'Agent Smith' }]),
          },
        },
      ],
    }).compile();

    service = module.get<SkillService>(SkillService);
    skillRepo = module.get(getRepositoryToken(Skill));
    agentSkillRepo = module.get(getRepositoryToken(AgentSkill));
    tagRepo = module.get(getRepositoryToken(Tag));
    departmentRepo = module.get(getRepositoryToken(Department));
  });

  it('listForAdmin returns counts derived from relations', async () => {
    skillRepo.find.mockResolvedValueOnce([
      {
        ...baseSkill,
        routingTags: [{ id: 1 }, { id: 2 }],
        routingDepartments: [{ id: 5 }],
        agentSkills: [{ id: 1, userId: 42, skillId: 1, proficiency: 4 }],
      },
    ]);

    const result = await service.listForAdmin();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      name: 'Networking',
      agentsCount: 1,
      routingTagsCount: 2,
      routingDepartmentsCount: 1,
    });
  });

  it('findForEdit returns ids only for routing relations', async () => {
    skillRepo.findOne.mockResolvedValueOnce({
      ...baseSkill,
      routingTags: [{ id: 11 }, { id: 12 }],
      routingDepartments: [{ id: 21 }],
      agentSkills: [
        { id: 1, userId: 100, skillId: 1, proficiency: 5 },
        { id: 2, userId: 101, skillId: 1, proficiency: 2 },
      ],
    });

    const payload = await service.findForEdit(1);

    expect(payload.routingTagIds).toEqual([11, 12]);
    expect(payload.routingDepartmentIds).toEqual([21]);
    expect(payload.agents).toEqual([
      { userId: 100, proficiency: 5 },
      { userId: 101, proficiency: 2 },
    ]);
  });

  it('getFormContext surfaces tags, departments, and agents', async () => {
    const context = await service.getFormContext();

    expect(context.availableTags).toEqual([{ id: 1, name: 'bug' }]);
    expect(context.availableDepartments).toEqual([{ id: 1, name: 'Support' }]);
    expect(context.availableAgents).toEqual([
      { id: 42, name: 'Agent Smith', email: '' },
    ]);
  });

  it('create slugifies the name when no slug is provided', async () => {
    await service.create({ name: 'Customer Success!' });

    expect(skillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'customer-success' }),
    );
  });

  it('create persists routing tags, departments, and agent rows', async () => {
    await service.create({
      name: 'Networking',
      routingTagIds: [1],
      routingDepartmentIds: [1],
      agents: [{ userId: 99, proficiency: 4 }],
    });

    expect(tagRepo.findBy).toHaveBeenCalled();
    expect(departmentRepo.findBy).toHaveBeenCalled();
    expect(agentSkillRepo.delete).toHaveBeenCalledWith({ skillId: 2 });
    expect(agentSkillRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ skillId: 2, userId: 99, proficiency: 4 }),
    ]);
  });

  it('update replaces relations only when provided', async () => {
    await service.update(1, { name: 'Renamed' });

    expect(tagRepo.findBy).not.toHaveBeenCalled();
    expect(departmentRepo.findBy).not.toHaveBeenCalled();
    expect(agentSkillRepo.delete).not.toHaveBeenCalled();
  });

  it('delete clears agent skill rows before removing the skill', async () => {
    await service.delete(1);

    expect(agentSkillRepo.delete).toHaveBeenCalledWith({ skillId: 1 });
    expect(skillRepo.remove).toHaveBeenCalled();
  });
});
