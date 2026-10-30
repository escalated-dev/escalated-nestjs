import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { UiDataService } from '../../src/ui/ui-data.service';
import { apiFetch, bootUi, inertiaFetch } from './ui-harness';

jest.setTimeout(60000);

/**
 * A refusal or a failure inside the panel stays inside the panel.
 *
 * An Inertia visit that gets an error document back has nowhere to put it: the
 * client opens it in a modal over the screen the user was on. So an Inertia
 * visit to one of Escalated's screens that ends in 403, 404, 419, 429, 500 or
 * 503 gets the shared frontend's `Escalated/Error` page, with the props
 * escalated-rails and escalated-laravel send: the status and a generic message.
 *
 * Everything else is left to the host: full page loads, API clients, the
 * host's own routes, and the host's own exception filters.
 */

@Controller('host')
class HostController {
  @Get('missing')
  missing(): never {
    throw new NotFoundException('host thing missing');
  }
}

/** The host's own global filter, which must keep answering what Escalated leaves alone. */
@Catch()
class HostFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    host.switchToHttp().getResponse().status(status).json({ handledBy: 'host', status });
  }
}

/** An exception of the host's own, with a global filter written for it. */
class HostGoneException extends NotFoundException {}

@Catch(HostGoneException)
class HostGoneFilter implements ExceptionFilter {
  catch(_exception: HostGoneException, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(410).json({ handledBy: 'host-gone' });
  }
}

const MESSAGES: Record<number, string> = {
  403: 'You are not authorized to perform this action.',
  404: 'The requested resource was not found.',
  419: 'Your session has expired. Refresh the page and try again.',
  429: 'Too many requests. Wait a moment and try again.',
  500: 'Something went wrong on our end.',
  503: 'The service is temporarily unavailable. Try again shortly.',
};

describe('Escalated/Error (ui.enabled)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootUi({}, { controllers: [HostController] }, (nest) =>
      nest.useGlobalFilters(new HostFilter(), new HostGoneFilter()),
    ));
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const failDashboardWith = (error: Error) =>
    jest.spyOn(app.get(UiDataService), 'agentDashboard').mockRejectedValueOnce(error);

  it('renders the Error page for an Inertia visit refused with a 403', async () => {
    const res = await inertiaFetch(base, '/escalated/admin/settings', { as: 'agent' });

    expect(res.status).toBe(403);
    expect(res.headers.get('x-inertia')).toBe('true');
    const body = await res.json();
    expect(body.component).toBe('Escalated/Error');
    expect(body.props.status).toBe(403);
    expect(body.props.message).toBe(MESSAGES[403]);
  });

  it('renders the Error page for an Inertia visit to a missing ticket, without its message', async () => {
    const res = await inertiaFetch(base, '/escalated/agent/tickets/NOPE-404');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.component).toBe('Escalated/Error');
    expect(body.props.status).toBe(404);
    expect(body.props.message).toBe(MESSAGES[404]);
  });

  it.each([419, 429, 503])('renders the Error page for a %i', async (status) => {
    failDashboardWith(new HttpException('internal detail', status));

    const res = await inertiaFetch(base, '/escalated/agent');

    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.component).toBe('Escalated/Error');
    expect(body.props.status).toBe(status);
    expect(body.props.message).toBe(MESSAGES[status]);
  });

  it('renders the Error page for an unexpected failure, and never its message', async () => {
    failDashboardWith(new Error('SQLITE_ERROR: secret table missing'));

    const res = await inertiaFetch(base, '/escalated/agent');

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).component).toBe('Escalated/Error');
    expect(JSON.parse(text).props.status).toBe(500);
    expect(JSON.parse(text).props.message).toBe(MESSAGES[500]);
    expect(text).not.toContain('SQLITE_ERROR');
    expect(text).not.toContain('secret table');
  });

  it('sends only the status and the message as its own props', async () => {
    const res = await inertiaFetch(base, '/escalated/admin/settings', { as: 'agent' });
    const { props } = await res.json();

    expect(props).toHaveProperty('status');
    expect(props).toHaveProperty('message');
    expect(props).not.toHaveProperty('home');
    expect(props).not.toHaveProperty('exception');
  });

  it('leaves a status the page has no wording for to the host', async () => {
    failDashboardWith(new HttpException('teapot', 418));

    const res = await inertiaFetch(base, '/escalated/agent');

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ handledBy: 'host', status: 418 });
  });

  it('leaves an exception the host has its own filter for to that filter', async () => {
    failDashboardWith(new HostGoneException());

    const res = await inertiaFetch(base, '/escalated/agent');

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ handledBy: 'host-gone' });
  });

  it('leaves a full page load to the host', async () => {
    const res = await fetch(`${base}/escalated/admin/settings`, {
      headers: { accept: 'text/html', 'x-role': 'agent', 'x-user': '21' },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('x-inertia')).toBeNull();
    expect(await res.json()).toEqual({ handledBy: 'host', status: 403 });
  });

  it('leaves an API client to the host', async () => {
    const res = await apiFetch(base, '/escalated/agent/tickets/NOPE-404');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ handledBy: 'host', status: 404 });
  });

  it("leaves an Inertia visit to the host's own routes to the host", async () => {
    const res = await inertiaFetch(base, '/host/missing');

    expect(res.status).toBe(404);
    expect(res.headers.get('x-inertia')).toBeNull();
    expect(await res.json()).toEqual({ handledBy: 'host', status: 404 });
  });

  it('still sends a failed screen form back to the form', async () => {
    const res = await inertiaFetch(base, '/escalated/agent/tickets/NOPE-404/reply', {
      body: { body: 'hello' },
      headers: { referer: `${base}/escalated/agent` },
    });

    expect([302, 303]).toContain(res.status);
    expect(res.headers.get('location')).toBe('/escalated/agent');
  });
});

/**
 * With `debug` on, a 500 is the developer's to read: it goes on to the host's
 * filters and Nest's own handling (which logs the stack) as it would without
 * Escalated, the way escalated-laravel leaves it to the framework's debug page
 * under APP_DEBUG. Every other status still gets the page.
 */
describe('Escalated/Error with debug on', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootUi({ debug: true }, { controllers: [HostController] }, (nest) =>
      nest.useGlobalFilters(new HostFilter()),
    ));
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const failDashboardWith = (error: Error) =>
    jest.spyOn(app.get(UiDataService), 'agentDashboard').mockRejectedValueOnce(error);

  it('leaves an unexpected failure to the host and Nest', async () => {
    failDashboardWith(new Error('SQLITE_ERROR: secret table missing'));

    const res = await inertiaFetch(base, '/escalated/agent');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ handledBy: 'host', status: 500 });
  });

  it('leaves a 500 HttpException to the host and Nest', async () => {
    failDashboardWith(new HttpException('internal detail', 500));

    const res = await inertiaFetch(base, '/escalated/agent');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ handledBy: 'host', status: 500 });
  });

  it('still renders the Error page for the other statuses', async () => {
    const res = await inertiaFetch(base, '/escalated/admin/settings', { as: 'agent' });

    expect(res.status).toBe(403);
    expect((await res.json()).component).toBe('Escalated/Error');
  });
});

describe('Escalated/Error with debug off explicitly', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootUi({ debug: false }, { controllers: [HostController] }, (nest) =>
      nest.useGlobalFilters(new HostFilter()),
    ));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('renders the Error page for an unexpected failure, and never its message', async () => {
    jest
      .spyOn(app.get(UiDataService), 'agentDashboard')
      .mockRejectedValueOnce(new Error('SQLITE_ERROR: secret table missing'));

    const res = await inertiaFetch(base, '/escalated/agent');

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).component).toBe('Escalated/Error');
    expect(text).not.toContain('SQLITE_ERROR');
  });
});
