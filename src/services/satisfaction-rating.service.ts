import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SatisfactionRating } from '../entities/satisfaction-rating.entity';
import { Ticket } from '../entities/ticket.entity';

@Injectable()
export class SatisfactionRatingService {
  constructor(
    @InjectRepository(SatisfactionRating)
    private readonly ratingRepo: Repository<SatisfactionRating>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
  ) {}

  async create(data: {
    ticketId: number;
    customerId: number;
    rating: number;
    comment?: string;
    ratingToken?: string;
  }): Promise<SatisfactionRating> {
    if (data.rating < 1 || data.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const ticket = await this.ticketRepo.findOne({ where: { id: data.ticketId } });
    if (!ticket) throw new NotFoundException(`Ticket #${data.ticketId} not found`);

    const existing = await this.ratingRepo.findOne({ where: { ticketId: data.ticketId } });
    if (existing) {
      throw new BadRequestException('This ticket already has a satisfaction rating');
    }

    const rating = await this.ratingRepo.save({
      ticketId: data.ticketId,
      customerId: data.customerId,
      agentId: ticket.assigneeId,
      rating: data.rating,
      comment: data.comment,
      ratingToken: data.ratingToken || uuidv4(),
    });

    await this.ticketRepo.update(data.ticketId, { satisfactionRatingId: rating.id });
    return rating;
  }

  async findByToken(token: string): Promise<SatisfactionRating> {
    const rating = await this.ratingRepo.findOne({
      where: { ratingToken: token },
    });
    if (!rating) throw new NotFoundException('Rating not found');
    return rating;
  }

  async submitByToken(token: string, ratingValue: number, comment?: string): Promise<SatisfactionRating> {
    const rating = await this.findByToken(token);
    rating.rating = ratingValue;
    if (comment) rating.comment = comment;
    return this.ratingRepo.save(rating);
  }

  async getStats(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{ average: number; total: number; distribution: Record<number, number> }> {
    const where: any = {};
    if (startDate && endDate) {
      where.createdAt = Between(startDate, endDate);
    }

    const ratings = await this.ratingRepo.find({ where });
    const total = ratings.length;
    const average = total > 0 ? ratings.reduce((sum, r) => sum + r.rating, 0) / total : 0;

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) {
      distribution[r.rating] = (distribution[r.rating] || 0) + 1;
    }

    return { average: Math.round(average * 100) / 100, total, distribution };
  }

  async getAgentStats(agentId: number): Promise<{ average: number; total: number }> {
    const ratings = await this.ratingRepo.find({ where: { agentId } });
    const total = ratings.length;
    const average = total > 0 ? ratings.reduce((sum, r) => sum + r.rating, 0) / total : 0;
    return { average: Math.round(average * 100) / 100, total };
  }
}
