import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../entities/ticket.entity';

@Injectable()
export class GuestAccessGuard implements CanActivate {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const guestToken = request.query.guest_token || request.headers['x-guest-token'];
    const ticketId = request.params.ticketId || request.params.id;

    if (!guestToken || !ticketId) {
      throw new ForbiddenException('Guest access token required');
    }

    const ticket = await this.ticketRepo.findOne({
      where: {
        id: parseInt(ticketId, 10),
        guestAccessToken: guestToken,
      },
    });

    if (!ticket) {
      throw new ForbiddenException('Invalid guest access token');
    }

    request.guestTicket = ticket;
    return true;
  }
}
