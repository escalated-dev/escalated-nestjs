import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../entities/contact.entity';
import { Ticket } from '../entities/ticket.entity';

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
  ) {}

  private normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  async findOrCreateByEmail(email: string, name?: string | null): Promise<Contact> {
    const normalized = this.normalize(email);
    const existing = await this.contactRepo.findOne({ where: { email: normalized } });

    if (existing) {
      if (!existing.name && name) {
        existing.name = name;
        return this.contactRepo.save(existing);
      }
      return existing;
    }

    const created = this.contactRepo.create({
      email: normalized,
      name: name ?? null,
      userId: null,
      metadata: {},
    });
    return this.contactRepo.save(created);
  }

  async findByEmail(email: string): Promise<Contact | null> {
    return this.contactRepo.findOne({ where: { email: this.normalize(email) } });
  }

  async findById(id: number): Promise<Contact | null> {
    return this.contactRepo.findOne({ where: { id } });
  }

  async linkToUser(contactId: number, userId: number): Promise<Contact> {
    const existing = await this.contactRepo.findOne({ where: { id: contactId } });
    if (!existing) {
      throw new NotFoundException(`Contact ${contactId} not found`);
    }
    existing.userId = userId;
    return this.contactRepo.save(existing);
  }

  /**
   * Link a Contact to a host-app user and back-stamp `requesterId` on all
   * tickets previously created under this contact. Called when a guest
   * accepts a signup invite and the host app creates their account.
   */
  async promoteToUser(contactId: number, userId: number): Promise<Contact> {
    const linked = await this.linkToUser(contactId, userId);
    await this.ticketRepo.update({ contactId }, { requesterId: userId });
    return linked;
  }
}
