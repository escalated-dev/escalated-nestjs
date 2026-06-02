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
    if (!data || typeof data !== 'object') return {};
    return this.sanitizeValue(data, new WeakSet()) as Record<string, any>;
  }

  private sanitizeValue(value: any, seen: WeakSet<object>): any {
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      return value.map((item) => this.sanitizeValue(item, seen));
    }

    if (value instanceof Date || !value || typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    return Object.entries(value).reduce<Record<string, any>>((sanitized, [key, entry]) => {
      sanitized[key] = this.isSensitiveKey(key) ? '***' : this.sanitizeValue(entry, seen);
      return sanitized;
    }, {});
  }

  private isSensitiveKey(key: string): boolean {
    const words = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    if (words.includes('password') || words.includes('secret') || words.includes('token')) {
      return true;
    }

    if (words.includes('credential') || words.includes('credentials')) {
      return true;
    }

    return words.some((word, index) => word === 'api' && words[index + 1] === 'key');
  }
}
