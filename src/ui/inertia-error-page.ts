import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { FILTER_CATCH_EXCEPTIONS } from '@nestjs/common/constants';
import { ApplicationConfig, BaseExceptionFilter, HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import { InertiaPage } from './inertia';
import { InertiaReply, InertiaResponder } from './inertia-responder';
import { isInertiaRequest } from './request';
import { uiEnabled } from './ui-options';

export const ERROR_PAGE = 'Escalated/Error';

/**
 * The statuses the page renders, with the message it shows for each: the
 * wording escalated-rails and escalated-laravel send. Generic on purpose: an
 * exception's own message never reaches the page (a missing record names
 * what was looked up, a database error its SQL).
 */
export const ERROR_PAGE_MESSAGES: Readonly<Record<number, string>> = Object.freeze({
  403: 'You are not authorized to perform this action.',
  404: 'The requested resource was not found.',
  419: 'Your session has expired. Refresh the page and try again.',
  429: 'Too many requests. Wait a moment and try again.',
  500: 'Something went wrong on our end.',
  503: 'The service is temporarily unavailable. Try again shortly.',
});

/** Writes a finished Inertia reply (headers, status, body) to the response. */
export function writeInertiaReply(
  adapterHost: HttpAdapterHost,
  response: any,
  reply: InertiaReply,
) {
  const adapter = adapterHost.httpAdapter;
  for (const [name, value] of Object.entries(reply.headers)) {
    // A cookie the handler set (the import wizard's) stays beside the flash one.
    if (name.toLowerCase() === 'set-cookie') adapter.appendHeader(response, name, value);
    else adapter.setHeader(response, name, value);
  }
  adapter.reply(response, reply.body ?? '', reply.status);
}

/**
 * Answers an Inertia visit to an Escalated screen that ends in 403, 404, 419,
 * 429, 500 or 503 with the shared frontend's `Escalated/Error` page, props
 * `{ status, message }`, instead of an error document the Inertia client can
 * only show in a modal over the screen the user was on.
 *
 * It is bound to Escalated's screen controllers only (`@EscalatedUi()`), so
 * the host's own routes never reach it. A global filter written for the
 * exception's type (`@Catch(SomeException)`: the two-factor redirect, or one
 * of the host's) still answers it. Anything it does not answer -- a full
 * page load, an API client, another status -- goes on to the filters it would
 * have reached without this one: the app's global filters (the host's
 * `useGlobalFilters` / `APP_FILTER`), then Nest's default handling. A
 * controller-bound filter that catches everything would otherwise take those
 * exceptions away from the host.
 *
 * With the module's `debug` option on, a 500 is passed on the same way, so
 * the developer sees the failure as Nest reports it (escalated-laravel leaves
 * it to the framework's debug page under `APP_DEBUG`).
 */
@Catch()
@Injectable()
export class InertiaErrorFilter implements ExceptionFilter {
  private readonly responder: InertiaResponder;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ApplicationConfig,
    moduleRef: ModuleRef,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {
    this.responder = new InertiaResponder(this.options ?? {}, moduleRef);
  }

  catch(exception: unknown, host: ArgumentsHost): unknown {
    // A global filter written for this exception type (the two-factor
    // redirect, or one of the host's) keeps it: it is a deliberate answer.
    const specific = this.globalFilterFor(exception, false);
    if (specific) return specific.catch(exception, host);

    const status = this.statusFor(exception, host);
    if (status === null) return this.passOn(exception, host);

    return this.render(status, host).catch(() => this.passOn(exception, host));
  }

  /** The status to render the page for, or null to leave the exception alone. */
  private statusFor(exception: unknown, host: ArgumentsHost): number | null {
    if (host.getType() !== 'http' || !uiEnabled(this.options)) return null;
    if (!isInertiaRequest(host.switchToHttp().getRequest())) return null;
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    // In debug mode a 500 is the developer's to read, as Nest would show it.
    if (status === 500 && this.options?.debug === true) return null;
    return status in ERROR_PAGE_MESSAGES ? status : null;
  }

  private async render(status: number, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const reply = await this.responder.page(
      new InertiaPage(ERROR_PAGE, { status, message: ERROR_PAGE_MESSAGES[status] }),
      http.getRequest(),
      host as ExecutionContext,
    );
    // A stale asset version still gets its 409, so the client reloads.
    writeInertiaReply(this.adapterHost, http.getResponse(), {
      ...reply,
      status: reply.status === 200 ? status : reply.status,
    });
  }

  /** Hands the exception to the first global filter that catches it, as Nest would have. */
  private passOn(exception: unknown, host: ArgumentsHost): unknown {
    const filter = this.globalFilterFor(exception, true);
    if (filter) return filter.catch(exception, host);

    return new BaseExceptionFilter(this.adapterHost.httpAdapter).catch(exception, host);
  }

  /**
   * The global filter Nest would pick for the exception (the last registered
   * one that catches it), optionally counting the catch-everything ones.
   */
  private globalFilterFor(exception: unknown, catchAll: boolean): ExceptionFilter | undefined {
    return [...this.config.getGlobalFilters()].reverse().find((candidate) => {
      const types: Array<abstract new (...args: any[]) => unknown> =
        Reflect.getMetadata(FILTER_CATCH_EXCEPTIONS, candidate.constructor) ?? [];
      if (!types.length) return catchAll;
      return types.some((type) => exception instanceof type);
    });
  }
}
