import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

export const AUDIT_ACTION = 'escalated_audit_action';
export const AuditAction = (action: string, entityType: string) =>
  SetMetadata(AUDIT_ACTION, { action, entityType });

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMeta = this.reflector.get<{ action: string; entityType: string }>(
      AUDIT_ACTION,
      context.getHandler(),
    );

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id || request.apiUserId || null;
    const ipAddress = request.ip || request.connection?.remoteAddress;
    const userAgent = request.headers['user-agent'];

    return next.handle().pipe(
      tap(async (response) => {
        try {
          const entityId = response?.id || request.params?.id || null;

          await this.auditLogRepo.save({
            userId: userId ?? undefined,
            action: auditMeta.action,
            entityType: auditMeta.entityType,
            entityId: entityId ? parseInt(entityId, 10) : undefined,
            newValues: auditMeta.action === 'create' ? this.sanitize(request.body) : undefined,
            ipAddress,
            userAgent,
          });
        } catch {
          // Silently fail - audit logging should never break the request
        }
      }),
    );
  }

  private sanitize(data: any): Record<string, any> {
    if (!data) return {};
    const sanitized = { ...data };
    const sensitiveKeys = ['password', 'secret', 'token', 'twoFactorSecret'];
    for (const key of sensitiveKeys) {
      if (sanitized[key]) {
        sanitized[key] = '***';
      }
    }
    return sanitized;
  }
}
