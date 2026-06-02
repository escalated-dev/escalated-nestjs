import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketSubject } from '../contracts/ticket-subject.interface';
import { TicketSubjectLink } from '../entities/ticket-subject-link.entity';
import { Ticket } from '../entities/ticket.entity';
import { EscalatedModuleOptions, ESCALATED_OPTIONS } from '../config/escalated.config';

export type SerializedTicketSubject = {
  type: string;
  id: string;
  role: string | null;
  title: string;
  subtitle: string | null;
  url: string | null;
  color: string | null;
  icon: string | null;
  missing: boolean;
};

export type TicketSubjectSyncItem = {
  subjectType: string;
  subjectId: string;
  role?: string | null;
};

@Injectable()
export class TicketSubjectService {
  constructor(
    @InjectRepository(TicketSubjectLink)
    private readonly linkRepo: Repository<TicketSubjectLink>,
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  private get allowedTypes(): string[] {
    return this.options.ticketSubjects?.types ?? [];
  }

  private get resolver():
    | ((type: string, id: string) => Promise<TicketSubject | null>)
    | undefined {
    return this.options.ticketSubjects?.resolver;
  }

  private assertTypeAllowed(subjectType: string): void {
    const allowed = this.allowedTypes;
    if (allowed.length > 0 && !allowed.includes(subjectType)) {
      throw new BadRequestException(
        `Subject type [${subjectType}] is not an allowed ticket subject.`,
      );
    }
  }

  async list(ticket: Ticket): Promise<TicketSubjectLink[]> {
    return this.linkRepo.find({
      where: { ticketId: ticket.id },
      order: { position: 'ASC' },
    });
  }

  async attach(
    ticket: Ticket,
    subjectType: string,
    subjectId: string | number,
    role?: string | null,
  ): Promise<TicketSubjectLink> {
    this.assertTypeAllowed(subjectType);

    const id = String(subjectId);
    const existing = await this.linkRepo.findOne({
      where: { ticketId: ticket.id, subjectType, subjectId: id },
    });

    if (existing) {
      if (role !== undefined) {
        existing.role = role;
      }
      return this.linkRepo.save(existing);
    }

    const maxPosition =
      (
        await this.linkRepo
          .createQueryBuilder('link')
          .select('MAX(link.position)', 'max')
          .where('link.ticketId = :ticketId', { ticketId: ticket.id })
          .getRawOne()
      )?.max ?? -1;

    return this.linkRepo.save({
      ticketId: ticket.id,
      subjectType,
      subjectId: id,
      role: role ?? null,
      position: Number(maxPosition) + 1,
    });
  }

  async detach(ticket: Ticket, linkId: number): Promise<void> {
    const link = await this.linkRepo.findOne({
      where: { id: linkId, ticketId: ticket.id },
    });
    if (!link) {
      throw new NotFoundException(`Ticket subject link #${linkId} not found`);
    }
    await this.linkRepo.remove(link);
  }

  async detachByKey(
    ticket: Ticket,
    subjectType: string,
    subjectId: string | number,
  ): Promise<void> {
    await this.linkRepo.delete({
      ticketId: ticket.id,
      subjectType,
      subjectId: String(subjectId),
    });
  }

  async sync(ticket: Ticket, items: TicketSubjectSyncItem[]): Promise<TicketSubjectLink[]> {
    await this.linkRepo.delete({ ticketId: ticket.id });

    const links: TicketSubjectLink[] = [];
    let position = 0;
    for (const item of items) {
      this.assertTypeAllowed(item.subjectType);
      const link = await this.linkRepo.save({
        ticketId: ticket.id,
        subjectType: item.subjectType,
        subjectId: String(item.subjectId),
        role: item.role ?? null,
        position: position++,
      });
      links.push(link);
    }
    return links;
  }

  async serializeLinks(links: TicketSubjectLink[]): Promise<SerializedTicketSubject[]> {
    const resolver = this.resolver;
    const result: SerializedTicketSubject[] = [];

    for (const link of links) {
      const resolved = resolver ? await resolver(link.subjectType, link.subjectId) : null;
      const presents = resolved !== null;

      result.push({
        type: link.subjectType,
        id: link.subjectId,
        role: link.role,
        title: presents ? resolved!.ticketSubjectTitle() : `${link.subjectType}#${link.subjectId}`,
        subtitle: presents ? resolved!.ticketSubjectSubtitle() : null,
        url: presents ? resolved!.ticketSubjectUrl() : null,
        color: presents ? resolved!.ticketSubjectColor() : null,
        icon: presents ? resolved!.ticketSubjectIcon() : null,
        missing: !presents,
      });
    }

    return result;
  }

  async serializeForTicket(ticket: Ticket): Promise<SerializedTicketSubject[]> {
    const links = await this.list(ticket);
    return this.serializeLinks(links);
  }
}
