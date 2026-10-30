import {
  applyDecorators,
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { Observable, catchError, mergeMap } from 'rxjs';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { InertiaBack, InertiaPage, InertiaRedirect } from './inertia';
import { InertiaErrorFilter, writeInertiaReply } from './inertia-error-page';
import { InertiaReply, InertiaResponder } from './inertia-responder';
import { acceptsHtml, isInertiaRequest, isScriptedRequest, sameOriginReferer } from './request';
import { uiEnabled } from './ui-options';

/**
 * Carries a finished Inertia response from the interceptor to the filter.
 *
 * Nest writes a handler's return value with the route's fixed status code, so
 * a `303` redirect or a `409` cannot be returned as a value. The interceptor
 * throws this instead and `InertiaReplyFilter` writes it.
 */
export class InertiaReplyException extends Error {
  constructor(readonly reply: InertiaReply) {
    super('Inertia response');
  }
}

/** Field errors a screen's form shows next to its inputs. */
export class UiValidationException extends HttpException {
  constructor(readonly errors: Record<string, string>) {
    super({ message: Object.values(errors)[0] ?? 'The given data was invalid.', errors }, 422);
  }
}

function messageOf(error: HttpException): string {
  const response = error.getResponse() as any;
  const message = typeof response === 'string' ? response : response?.message;
  return Array.isArray(message) ? message.join(' ') : String(message ?? error.message);
}

/**
 * Field errors in an exception, as `UiValidationException` carries them or as
 * the `{ errors: { field: [messages] } }` 422 body the JSON API answers with.
 */
function fieldErrors(error: HttpException): Record<string, string> | null {
  if (error instanceof UiValidationException) return error.errors;
  const errors = (error.getResponse() as any)?.errors;
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return null;
  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(errors)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') out[field] = first;
  }
  return Object.keys(out).length ? out : null;
}

@Injectable()
export class InertiaInterceptor implements NestInterceptor {
  private readonly responder: InertiaResponder;

  constructor(
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {
    this.responder = new InertiaResponder(this.options ?? {}, moduleRef);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!uiEnabled(this.options) || context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const browser = isInertiaRequest(request) || acceptsHtml(request);

    return next.handle().pipe(
      mergeMap(async (result) => {
        if (result instanceof InertiaPage) {
          throw new InertiaReplyException(await this.responder.page(result, request, context));
        }
        if (result instanceof InertiaRedirect && browser) {
          throw new InertiaReplyException(this.responder.redirect(result, request));
        }
        return result;
      }),
      catchError((error) => {
        // A failed form on a screen goes back to it with the error to show,
        // instead of an error document the Inertia client cannot display.
        if (
          !(error instanceof InertiaReplyException) &&
          error instanceof HttpException &&
          isInertiaRequest(request) &&
          request.method !== 'GET' &&
          [400, 404, 409, 422].includes(error.getStatus())
        ) {
          const fallback = sameOriginReferer(request) ?? '/';
          const errors = fieldErrors(error);
          const reply = errors
            ? this.responder.invalid(request, fallback, errors)
            : this.responder.redirect(
                new InertiaBack(fallback, { error: messageOf(error) }),
                request,
              );
          throw new InertiaReplyException(reply);
        }
        throw error;
      }),
    );
  }
}

@Catch(InertiaReplyException)
export class InertiaReplyFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: InertiaReplyException, host: ArgumentsHost): void {
    writeInertiaReply(this.adapterHost, host.switchToHttp().getResponse(), exception.reply);
  }
}

/**
 * Refuses a state-changing screen request that a page script did not make
 * (`X-Inertia` or `X-Requested-With`): another site's plain form cannot set
 * those headers, so it cannot submit the screens' forms with the user's cookies.
 */
@Injectable()
export class ScriptedRequestGuard {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(request.method).toUpperCase())) return true;
    if (!isScriptedRequest(request)) {
      throw new ForbiddenException('Screen forms must be sent by the Escalated client');
    }
    return true;
  }
}

/**
 * For routes shared by the JSON API and the screens: with `ui.enabled`,
 * refuses a state-changing browser request (one asking for HTML) that a page
 * script did not send, i.e. another site's plain form. API clients are
 * unaffected, and nothing changes while the screens are off.
 */
@Injectable()
export class BrowserFormGuard {
  constructor(
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!uiEnabled(this.options)) return true;
    const request = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(request.method).toUpperCase())) return true;
    if (acceptsHtml(request) && !isScriptedRequest(request)) {
      throw new ForbiddenException('Screen forms must be sent by the Escalated client');
    }
    return true;
  }
}

/**
 * Marks a controller whose handlers may return `inertia(...)` / `redirect(...)`
 * values, and whose errors an Inertia visit sees as `Escalated/Error`. Inert
 * unless `ui.enabled`.
 */
export function EscalatedUi(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    UseInterceptors(InertiaInterceptor),
    // Nest tries the last-listed filter first: a finished reply is written
    // before the error page is considered.
    UseFilters(InertiaErrorFilter, InertiaReplyFilter),
  ) as ClassDecorator & MethodDecorator;
}
