import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';

@Injectable()
export class NewsletterEnabledGuard implements CanActivate {
  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.options.enableNewsletters) {
      throw new NotFoundException();
    }
    return true;
  }
}
