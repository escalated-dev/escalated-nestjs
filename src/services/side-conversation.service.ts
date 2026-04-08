import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SideConversation } from '../entities/side-conversation.entity';
import { SideConversationReply } from '../entities/side-conversation-reply.entity';

@Injectable()
export class SideConversationService {
  constructor(
    @InjectRepository(SideConversation)
    private readonly sideConvRepo: Repository<SideConversation>,
    @InjectRepository(SideConversationReply)
    private readonly replyRepo: Repository<SideConversationReply>,
  ) {}

  async findByTicket(ticketId: number): Promise<SideConversation[]> {
    return this.sideConvRepo.find({
      where: { ticketId },
      relations: ['replies'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: number): Promise<SideConversation> {
    const conv = await this.sideConvRepo.findOne({
      where: { id },
      relations: ['replies'],
    });
    if (!conv) throw new NotFoundException(`Side conversation #${id} not found`);
    return conv;
  }

  async create(data: {
    ticketId: number;
    subject: string;
    createdBy: number;
    participants?: number[];
    body: string;
  }): Promise<SideConversation> {
    const conv = await this.sideConvRepo.save({
      ticketId: data.ticketId,
      subject: data.subject,
      createdBy: data.createdBy,
      participants: data.participants || [],
    });

    // Create the initial reply
    await this.replyRepo.save({
      sideConversationId: conv.id,
      userId: data.createdBy,
      body: data.body,
    });

    return this.findById(conv.id);
  }

  async addReply(
    sideConversationId: number,
    userId: number,
    body: string,
  ): Promise<SideConversationReply> {
    await this.findById(sideConversationId);
    return this.replyRepo.save({
      sideConversationId,
      userId,
      body,
    });
  }

  async close(id: number): Promise<SideConversation> {
    await this.findById(id);
    await this.sideConvRepo.update(id, { status: 'closed' });
    return this.findById(id);
  }

  async reopen(id: number): Promise<SideConversation> {
    await this.findById(id);
    await this.sideConvRepo.update(id, { status: 'open' });
    return this.findById(id);
  }
}
