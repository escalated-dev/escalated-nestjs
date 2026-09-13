import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { lookup } from 'dns/promises';
import { WebhookService } from '../../src/services/webhook.service';
import { Webhook } from '../../src/entities/webhook.entity';
import { WebhookDelivery } from '../../src/entities/webhook-delivery.entity';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

const lookupMock = lookup as unknown as jest.Mock;

/**
 * Webhook URLs are admin-supplied and fetched by the server, so a webhook must
 * never be able to reach loopback, private, link-local or reserved addresses,
 * whether written as an IP literal or reached through DNS.
 */
describe('WebhookService URL safety', () => {
  let service: WebhookService;
  let webhookRepo: Record<string, jest.Mock>;
  let deliveryRepo: Record<string, jest.Mock>;
  let failedDeliveries: any[];
  let fetchMock: jest.SpyInstance;

  const storedWebhook = (url: string) => ({
    id: 1,
    name: 'Hook',
    url,
    secret: 'secret',
    events: ['*'],
    isActive: true,
    failureCount: 0,
  });

  beforeEach(async () => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('ok', { status: 200 }));
    failedDeliveries = [];

    webhookRepo = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => storedWebhook('https://hooks.example.com/escalated')),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 1, ...data })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    deliveryRepo = {
      save: jest.fn(async (d) => ({ id: 1, ...d })),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => failedDeliveries),
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: getRepositoryToken(Webhook), useValue: webhookRepo },
        { provide: getRepositoryToken(WebhookDelivery), useValue: deliveryRepo },
      ],
    }).compile();

    service = moduleRef.get(WebhookService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  describe('when saving', () => {
    it.each([
      'http://127.0.0.1/hook',
      'http://127.1/hook',
      'http://2130706433/hook',
      'http://localhost:3000/hook',
      'http://0.0.0.0/hook',
      'http://10.1.2.3/hook',
      'http://172.16.0.1/hook',
      'http://192.168.1.10/hook',
      'http://100.64.0.1/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.0.2.10/hook',
      'http://198.18.0.1/hook',
      'http://224.0.0.1/hook',
      'http://255.255.255.255/hook',
      'http://[::1]/hook',
      'http://[::]/hook',
      'http://[::ffff:127.0.0.1]/hook',
      'http://[fd12:3456::1]/hook',
      'http://[fe80::1]/hook',
      'http://[2001:db8::1]/hook',
      'ftp://93.184.216.34/hook',
      'file:///etc/passwd',
      'not a url',
    ])('rejects %s', async (url) => {
      await expect(service.create({ name: 'Hook', url, events: ['*'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(webhookRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a hostname that resolves to a private address', async () => {
      lookupMock.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);

      await expect(
        service.create({ name: 'Hook', url: 'https://hooks.internal.example/x', events: ['*'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(lookupMock).toHaveBeenCalledWith('hooks.internal.example', expect.anything());
    });

    it('rejects a hostname when any of its addresses is private', async () => {
      lookupMock.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '::1', family: 6 },
      ]);

      await expect(
        service.create({ name: 'Hook', url: 'https://hooks.example.com/x', events: ['*'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a hostname that does not resolve', async () => {
      lookupMock.mockRejectedValue(
        Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      );

      await expect(
        service.create({ name: 'Hook', url: 'https://nowhere.example/x', events: ['*'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a URL whose host resolves only to public addresses', async () => {
      await expect(
        service.create({ name: 'Hook', url: 'https://hooks.example.com/x', events: ['*'] }),
      ).resolves.toMatchObject({ url: 'https://hooks.example.com/x' });
      expect(webhookRepo.save).toHaveBeenCalled();
    });

    it('rejects an update that points the webhook at a private address', async () => {
      await expect(service.update(1, { url: 'http://192.168.0.5/hook' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(webhookRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('when sending', () => {
    it('does not send to a stored private address', async () => {
      const delivery = await service.dispatch(
        storedWebhook('http://169.254.169.254/latest/meta-data/') as Webhook,
        'ticket.created',
        {},
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(delivery.status).toBe('failed');
    });

    it('re-resolves the host at send time', async () => {
      lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

      const delivery = await service.dispatch(
        storedWebhook('https://hooks.example.com/escalated') as Webhook,
        'ticket.created',
        {},
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(delivery.status).toBe('failed');
    });

    it('does not follow redirects', async () => {
      await service.dispatch(
        storedWebhook('https://hooks.example.com/escalated') as Webhook,
        'ticket.created',
        {},
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://hooks.example.com/escalated',
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('does not retry into a private address', async () => {
      webhookRepo.findOne.mockResolvedValue(storedWebhook('http://10.0.0.1/hook'));
      failedDeliveries = [
        { id: 9, webhookId: 1, event: 'ticket.created', payload: '{}', attempts: 1 },
      ];

      await service.retryFailedDeliveries(3);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(deliveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 9, attempts: 2 }),
      );
    });

    it('retries with redirects disabled', async () => {
      failedDeliveries = [
        { id: 9, webhookId: 1, event: 'ticket.created', payload: '{}', attempts: 1 },
      ];

      await service.retryFailedDeliveries(3);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://hooks.example.com/escalated',
        expect.objectContaining({ redirect: 'manual' }),
      );
    });
  });
});
