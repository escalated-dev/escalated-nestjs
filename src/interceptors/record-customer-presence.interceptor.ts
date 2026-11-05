import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { from, mergeMap, Observable } from 'rxjs';
import { CustomerPresenceService } from '../services/customer-presence.service';

/**
 * Customer-portal requests record that the signed-in customer is on the site
 * (throttled; ADR 2026-11-05-agent-panel-data). Staff browsing the portal are
 * not recorded. Presence is a hint and never fails the request.
 */
@Injectable()
export class RecordCustomerPresenceInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly presence?: CustomerPresenceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const presence = this.presence;
    if (!presence || context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const id = request?.user?.id;
    if (id == null) return next.handle();
    // Recorded before the handler: screens answer by throwing their reply.
    return from(presence.quietly(() => presence.seeUser(id))).pipe(mergeMap(() => next.handle()));
  }
}
