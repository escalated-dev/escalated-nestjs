import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Macro } from '../entities/macro.entity';
import { Ticket } from '../entities/ticket.entity';
import { Reply } from '../entities/reply.entity';

@Injectable()
export class MacroService {
  constructor(
    @InjectRepository(Macro)
    private readonly macroRepo: Repository<Macro>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Reply)
    private readonly replyRepo: Repository<Reply>,
  ) {}

  async findAll(userId?: number): Promise<Macro[]> {
    const qb = this.macroRepo
      .createQueryBuilder('macro')
      .where('macro.isActive = :isActive', { isActive: true })
      .andWhere('(macro.scope = :shared OR macro.createdBy = :userId)', {
        shared: 'shared',
        userId: userId || 0,
      })
      .orderBy('macro.name', 'ASC');

    return qb.getMany();
  }

  async findById(id: number): Promise<Macro> {
    const macro = await this.macroRepo.findOne({ where: { id } });
    if (!macro) throw new NotFoundException(`Macro #${id} not found`);
    return macro;
  }

  async create(data: Partial<Macro>): Promise<Macro> {
    const macro = this.macroRepo.create(data);
    return this.macroRepo.save(macro);
  }

  async update(id: number, data: Partial<Macro>): Promise<Macro> {
    await this.findById(id);
    await this.macroRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const macro = await this.findById(id);
    await this.macroRepo.remove(macro);
  }

  async execute(macroId: number, ticketId: number, userId: number): Promise<Ticket> {
    const macro = await this.findById(macroId);
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException(`Ticket #${ticketId} not found`);

    for (const action of macro.actions) {
      await this.executeAction(ticket, action, userId);
    }

    // Increment usage count
    await this.macroRepo.update(macroId, { usageCount: () => 'usageCount + 1' });

    return this.ticketRepo.findOne({ where: { id: ticketId }, relations: ['status', 'tags'] });
  }

  private async executeAction(
    ticket: Ticket,
    action: Record<string, any>,
    userId: number,
  ): Promise<void> {
    switch (action.type) {
      case 'set_status':
        await this.ticketRepo.update(ticket.id, { statusId: action.value });
        break;
      case 'set_priority':
        await this.ticketRepo.update(ticket.id, { priority: action.value });
        break;
      case 'set_department':
        await this.ticketRepo.update(ticket.id, { departmentId: action.value });
        break;
      case 'assign':
        await this.ticketRepo.update(ticket.id, { assigneeId: action.value });
        break;
      case 'add_reply':
        await this.replyRepo.save({
          ticketId: ticket.id,
          userId,
          body: action.value,
          type: 'reply',
          isInternal: false,
        });
        break;
      case 'add_note':
        await this.replyRepo.save({
          ticketId: ticket.id,
          userId,
          body: action.value,
          type: 'note',
          isInternal: true,
        });
        break;
    }
  }
}
