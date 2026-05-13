import { Test, TestingModule } from '@nestjs/testing';
import { AdminSkillController } from '../../src/controllers/admin/skill.controller';
import { SkillService } from '../../src/services/skill.service';
import { AuditLogInterceptor } from '../../src/interceptors/audit-log.interceptor';
import { Reflector } from '@nestjs/core';

describe('AdminSkillController', () => {
  let controller: AdminSkillController;
  let skillService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSkillController],
      providers: [
        {
          provide: SkillService,
          useValue: {
            listForAdmin: jest.fn().mockResolvedValue([
              {
                id: 1,
                name: 'Networking',
                slug: 'networking',
                description: null,
                agentsCount: 2,
                routingTagsCount: 1,
                routingDepartmentsCount: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
            findForEdit: jest.fn().mockResolvedValue({
              id: 1,
              name: 'Networking',
              slug: 'networking',
              description: null,
              routingTagIds: [3],
              routingDepartmentIds: [],
              agents: [{ userId: 7, proficiency: 4 }],
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
            getFormContext: jest.fn().mockResolvedValue({
              availableTags: [{ id: 3, name: 'bug' }],
              availableDepartments: [{ id: 5, name: 'Support' }],
              availableAgents: [{ id: 7, name: 'Agent Smith', email: '' }],
            }),
            create: jest.fn().mockResolvedValue({ id: 2 }),
            update: jest.fn().mockResolvedValue({ id: 1 }),
            delete: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: Reflector,
          useValue: { get: jest.fn(), getAllAndOverride: jest.fn() },
        },
      ],
    })
      .overrideInterceptor(AuditLogInterceptor)
      .useValue({ intercept: (_, next) => next.handle() })
      .compile();

    controller = module.get<AdminSkillController>(AdminSkillController);
    skillService = module.get(SkillService);
  });

  it('list wraps the service payload in { skills }', async () => {
    const result = await controller.list();
    expect(result.skills).toHaveLength(1);
    expect(skillService.listForAdmin).toHaveBeenCalled();
  });

  it('newForm returns form context', async () => {
    const result = await controller.newForm();
    expect(result.availableTags).toHaveLength(1);
    expect(result.availableAgents).toHaveLength(1);
  });

  it('edit merges skill payload with form context', async () => {
    const result = await controller.edit(1);
    expect(result.skill.id).toBe(1);
    expect(result.skill.routingTagIds).toEqual([3]);
    expect(result.availableAgents).toHaveLength(1);
  });

  it('create delegates to service.create', async () => {
    const dto = {
      name: 'Networking',
      routingTagIds: [3],
      agents: [{ userId: 7, proficiency: 4 }],
    };
    await controller.create(dto);
    expect(skillService.create).toHaveBeenCalledWith(dto);
  });

  it('update delegates to service.update', async () => {
    await controller.update(1, { name: 'Renamed' });
    expect(skillService.update).toHaveBeenCalledWith(1, { name: 'Renamed' });
  });

  it('destroy delegates to service.delete', async () => {
    await controller.destroy(1);
    expect(skillService.delete).toHaveBeenCalledWith(1);
  });
});
