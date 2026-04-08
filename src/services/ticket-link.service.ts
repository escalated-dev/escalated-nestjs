import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketLink } from '../entities/ticket-link.entity';
import { Ticket } from '../entities/ticket.entity';

@Injectable()
export class TicketLinkService {
  constructor(
    @InjectRepository(TicketLink)
    private readonly linkRepo: Repository<TicketLink>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
  ) {}

  async findByTicket(ticketId: number): Promise<TicketLink[]> {
    return this.linkRepo.find({
      where: [{ ticketId }, { linkedTicketId: ticketId }],
      relations: ['ticket', 'linkedTicket'],
    });
  }

  async create(data: {
    ticketId: number;
    linkedTicketId: number;
    linkType: string;
  }): Promise<TicketLink> {
    if (data.ticketId === data.linkedTicketId) {
      throw new BadRequestException('Cannot link a ticket to itself');
    }

    // Verify both tickets exist
    const ticket = await this.ticketRepo.findOne({ where: { id: data.ticketId } });
    if (!ticket) throw new NotFoundException(`Ticket #${data.ticketId} not found`);

    const linked = await this.ticketRepo.findOne({ where: { id: data.linkedTicketId } });
    if (!linked) throw new NotFoundException(`Ticket #${data.linkedTicketId} not found`);

    // Check if link already exists
    const existing = await this.linkRepo.findOne({
      where: [
        { ticketId: data.ticketId, linkedTicketId: data.linkedTicketId },
        { ticketId: data.linkedTicketId, linkedTicketId: data.ticketId },
      ],
    });

    if (existing) {
      throw new BadRequestException('These tickets are already linked');
    }

    return this.linkRepo.save(data);
  }

  async delete(id: number): Promise<void> {
    const link = await this.linkRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException(`Ticket link #${id} not found`);
    await this.linkRepo.remove(link);
  }
}
