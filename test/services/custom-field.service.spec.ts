import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomFieldService } from '../../src/services/custom-field.service';
import { CustomField } from '../../src/entities/custom-field.entity';
import { CustomFieldValue } from '../../src/entities/custom-field-value.entity';

describe('CustomFieldService', () => {
  let service: CustomFieldService;
  let fieldRepo: any;
  let valueRepo: any;

  const mockField = {
    id: 1,
    name: 'Customer Type',
    slug: 'customer-type',
    fieldType: 'select',
    options: ['Enterprise', 'SMB', 'Individual'],
    isRequired: true,
    entityType: 'ticket',
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomFieldService,
        {
          provide: getRepositoryToken(CustomField),
          useValue: {
            find: jest.fn().mockResolvedValue([mockField]),
            findOne: jest.fn().mockResolvedValue(mockField),
            create: jest.fn().mockReturnValue(mockField),
            save: jest.fn().mockResolvedValue(mockField),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockField),
          },
        },
        {
          provide: getRepositoryToken(CustomFieldValue),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockResolvedValue({ id: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get<CustomFieldService>(CustomFieldService);
    fieldRepo = module.get(getRepositoryToken(CustomField));
    valueRepo = module.get(getRepositoryToken(CustomFieldValue));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a custom field', async () => {
      await service.create(mockField);
      expect(fieldRepo.save).toHaveBeenCalled();
    });

    it('should require options for select fields', async () => {
      await expect(
        service.create({ name: 'Bad', slug: 'bad', fieldType: 'select' }),
      ).rejects.toThrow('Options are required');
    });
  });

  describe('setValues', () => {
    it('should set field values', async () => {
      await service.setValues('ticket', 1, { 1: 'Enterprise' });
      expect(valueRepo.save).toHaveBeenCalled();
    });

    it('should validate select field values', async () => {
      await expect(
        service.setValues('ticket', 1, { 1: 'InvalidOption' }),
      ).rejects.toThrow('Invalid option');
    });
  });

  describe('getValues', () => {
    it('should return values for entity', async () => {
      await service.getValues('ticket', 1);
      expect(valueRepo.find).toHaveBeenCalledWith({
        where: { entityType: 'ticket', entityId: 1 },
        relations: ['customField'],
      });
    });
  });
});
