import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Contact } from '../../src/entities/contact.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { ContactService } from '../../src/services/contact.service';
import { buildContact } from '../factories';

describe('ContactService', () => {
  let service: ContactService;
  let contactRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let ticketRepo: {
    update: jest.Mock;
  };

  beforeEach(async () => {
    contactRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: x.id ?? 99 })),
    };
    ticketRepo = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: getRepositoryToken(Contact), useValue: contactRepo },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
      ],
    }).compile();

    service = moduleRef.get(ContactService);
  });

  describe('findOrCreateByEmail', () => {
    it('returns existing contact when email matches (case-insensitive)', async () => {
      const existing = buildContact({ email: 'alice@example.com' });
      contactRepo.findOne.mockResolvedValue(existing);

      const result = await service.findOrCreateByEmail('ALICE@example.com');

      expect(contactRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      });
      expect(contactRepo.save).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates a new contact when email is new', async () => {
      contactRepo.findOne.mockResolvedValue(null);

      const result = await service.findOrCreateByEmail('bob@example.com', 'Bob');

      expect(contactRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'bob@example.com',
          name: 'Bob',
          userId: null,
        }),
      );
      expect(contactRepo.save).toHaveBeenCalled();
      expect(result.email).toBe('bob@example.com');
      expect(result.name).toBe('Bob');
    });

    it('normalizes email to lowercase and trims whitespace on create', async () => {
      contactRepo.findOne.mockResolvedValue(null);

      const result = await service.findOrCreateByEmail('  UPPER@Case.COM  ');

      expect(result.email).toBe('upper@case.com');
    });

    it('fills in a blank name on an existing contact when one is provided', async () => {
      const existing = buildContact({ email: 'alice@example.com', name: null });
      contactRepo.findOne.mockResolvedValue(existing);
      contactRepo.save.mockImplementation(async (x) => x);

      const result = await service.findOrCreateByEmail('alice@example.com', 'Alice');

      expect(contactRepo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice' }));
      expect(result.name).toBe('Alice');
    });

    it('does not overwrite a non-blank existing name', async () => {
      const existing = buildContact({ email: 'alice@example.com', name: 'Alice' });
      contactRepo.findOne.mockResolvedValue(existing);

      const result = await service.findOrCreateByEmail('alice@example.com', 'Different');

      expect(contactRepo.save).not.toHaveBeenCalled();
      expect(result.name).toBe('Alice');
    });
  });

  describe('linkToUser', () => {
    it('sets userId on the contact', async () => {
      const existing = buildContact({ id: 7, userId: null });
      contactRepo.findOne.mockResolvedValue(existing);
      contactRepo.save.mockImplementation(async (x) => x);

      const updated = await service.linkToUser(7, 123);

      expect(updated.userId).toBe(123);
    });

    it('throws NotFoundException when contact not found', async () => {
      contactRepo.findOne.mockResolvedValue(null);
      await expect(service.linkToUser(7, 123)).rejects.toThrow('Contact 7 not found');
    });
  });

  describe('findByEmail', () => {
    it('normalizes before lookup', async () => {
      contactRepo.findOne.mockResolvedValue(null);
      await service.findByEmail('  MIX@Case.com ');
      expect(contactRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'mix@case.com' },
      });
    });
  });

  describe('findById', () => {
    it('returns null when not found', async () => {
      contactRepo.findOne.mockResolvedValue(null);
      const result = await service.findById(42);
      expect(result).toBeNull();
      expect(contactRepo.findOne).toHaveBeenCalledWith({ where: { id: 42 } });
    });
  });

  describe('promoteToUser', () => {
    it('links the contact and back-stamps requesterId on all prior tickets', async () => {
      const existing = buildContact({ id: 7, userId: null });
      contactRepo.findOne.mockResolvedValue(existing);
      contactRepo.save.mockImplementation(async (x) => x);
      ticketRepo.update.mockResolvedValue({ affected: 3 });

      const result = await service.promoteToUser(7, 555);

      expect(result.userId).toBe(555);
      expect(ticketRepo.update).toHaveBeenCalledWith({ contactId: 7 }, { requesterId: 555 });
    });

    it('throws when contact not found', async () => {
      contactRepo.findOne.mockResolvedValue(null);
      await expect(service.promoteToUser(7, 555)).rejects.toThrow('Contact 7 not found');
    });
  });
});
