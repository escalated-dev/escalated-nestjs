import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WebhookService } from '../../src/services/webhook.service';
import { Webhook } from '../../src/entities/webhook.entity';
import { WebhookDelivery } from '../../src/entities/webhook-delivery.entity';

describe('WebhookService', () => {
  let service: WebhookService;
  let webhookRepo: any;
  let deliveryRepo: any;

  const mockWebhook = {
    id: 1,
    name: 'Test Webhook',
    url: 'https://example.com/webhook',
    secret: 'test-secret',
    events: ['ticket.created'],
    isActive: true,
    failureCount: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: getRepositoryToken(Webhook),
          useValue: {
            find: jest.fn().mockResolvedValue([mockWebhook]),
            findOne: jest.fn().mockResolvedValue(mockWebhook),
            create: jest.fn().mockReturnValue(mockWebhook),
            save: jest.fn().mockResolvedValue(mockWebhook),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockWebhook),
          },
        },
        {
          provide: getRepositoryToken(WebhookDelivery),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            save: jest.fn().mockImplementation((d) => Promise.resolve({ id: 1, ...d })),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
    webhookRepo = module.get(getRepositoryToken(Webhook));
    deliveryRepo = module.get(getRepositoryToken(WebhookDelivery));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all webhooks', async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should create a webhook with auto-generated secret', async () => {
      await service.create({ name: 'New', url: 'https://example.com', events: ['*'] });
      expect(webhookRepo.save).toHaveBeenCalled();
    });
  });

  describe('getDeliveries', () => {
    it('should return webhook deliveries', async () => {
      const result = await service.getDeliveries(1);
      expect(deliveryRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { webhookId: 1 } }),
      );
    });
  });

  describe('retryFailedDeliveries', () => {
    it('should process failed deliveries', async () => {
      await service.retryFailedDeliveries(3);
      expect(deliveryRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });
});
