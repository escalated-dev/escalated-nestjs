import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from '../entities/attachment.entity';
import { Reply } from '../entities/reply.entity';
import { Ticket } from '../entities/ticket.entity';

/** The ticket an attachment belongs to, and whether customers may see it. */
export interface AttachmentOwner {
  ticket: Ticket | null;
  /** False for attachments on internal notes. */
  isPublic: boolean;
}

@Injectable()
export class AttachmentService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @Optional()
    @InjectRepository(Reply)
    private readonly replyRepo?: Repository<Reply>,
    @Optional()
    @InjectRepository(Ticket)
    private readonly ticketRepo?: Repository<Ticket>,
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

  /**
   * Resolves the ticket an attachment hangs off (directly or through its
   * reply), mirroring Laravel's AttachmentAccess::ticket().
   */
  async ownerOf(attachment: Attachment): Promise<AttachmentOwner> {
    let reply: Reply | null = null;
    if (attachment.replyId != null && this.replyRepo) {
      reply = await this.replyRepo.findOne({ where: { id: attachment.replyId } });
    }
    const ticketId = attachment.ticketId ?? reply?.ticketId ?? null;
    const ticket =
      ticketId != null && this.ticketRepo
        ? await this.ticketRepo.findOne({ where: { id: ticketId } })
        : null;
    const isPublic = !reply || (!reply.isInternal && reply.type !== 'note');
    return { ticket, isPublic };
  }
}
