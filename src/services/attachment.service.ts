import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from '../entities/attachment.entity';

@Injectable()
export class AttachmentService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
  ) {}

  async findById(id: number): Promise<Attachment> {
    const attachment = await this.attachmentRepo.findOne({ where: { id } });
    if (!attachment) {
      throw new NotFoundException(`Attachment #${id} not found`);
    }
    return attachment;
  }

  async findByTicketId(ticketId: number): Promise<Attachment[]> {
    return this.attachmentRepo.find({ where: { ticketId } });
  }
}
