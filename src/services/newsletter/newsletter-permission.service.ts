import { Injectable } from '@nestjs/common';
import { AccessControlService } from '../../access/access-control.service';

/**
 * The newsletter screens' `newsletters.manage` / `newsletters.send` checks.
 * They apply only while roles & permissions is switched on (ADR
 * 2026-10-29-configurable-access-features); while it is off the admin guard
 * on the newsletter routes decides, like every other admin screen.
 */
@Injectable()
export class NewsletterPermissionService {
  constructor(private readonly access: AccessControlService) {}

  async require(
    request: any,
    permission: 'newsletters.manage' | 'newsletters.send',
  ): Promise<void> {
    await this.access.require(request, permission);
  }
}
