import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { bootRouteTable } from './route-table';

jest.setTimeout(60000);

/**
 * The optional public route groups are registered only while their feature
 * is on: the widget (`widget.enabled` / `ESCALATED_WIDGET_ENABLED`) and the
 * guest portal (`guest.routesEnabled` / `ESCALATED_GUEST_ROUTES`), both on by
 * default. Slack inbound and the cloud webhook have no routes in this package.
 */
async function pathsFor(escalated: EscalatedModuleOptions): Promise<string[]> {
  const { app, table } = await bootRouteTable(escalated);
  try {
    return table.routes.map((route) => `${route.method} ${route.path}`);
  } finally {
    await app.close();
  }
}

const widget = (paths: string[]) => paths.filter((p) => / \/escalated\/widget(\/|$)/.test(p));
const guest = (paths: string[]) => paths.filter((p) => / \/escalated\/guest(\/|$)/.test(p));

describe('optional public route groups', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('registers the widget and guest routes by default', async () => {
    delete process.env.ESCALATED_WIDGET_ENABLED;
    delete process.env.ESCALATED_GUEST_ROUTES;
    const paths = await pathsFor({ ui: { enabled: true } });

    expect(widget(paths)).toEqual(
      expect.arrayContaining([
        'GET /escalated/widget/embed.js',
        'GET /escalated/widget/config',
        'POST /escalated/widget/tickets',
        'POST /escalated/widget/chat/start',
      ]),
    );
    expect(guest(paths)).toEqual(
      expect.arrayContaining([
        'POST /escalated/guest/verification',
        'GET /escalated/guest/create',
        'GET /escalated/guest/:token',
      ]),
    );
  });

  it('registers no widget route with widget.enabled false', async () => {
    const paths = await pathsFor({ ui: { enabled: true }, widget: { enabled: false } });

    expect(widget(paths)).toEqual([]);
    expect(guest(paths).length).toBeGreaterThan(0);
  });

  it('registers no guest route with guest.routesEnabled false', async () => {
    const paths = await pathsFor({ ui: { enabled: true }, guest: { routesEnabled: false } });

    expect(guest(paths)).toEqual([]);
    expect(widget(paths).length).toBeGreaterThan(0);
  });

  it('reads ESCALATED_WIDGET_ENABLED and ESCALATED_GUEST_ROUTES when the options are unset', async () => {
    process.env.ESCALATED_WIDGET_ENABLED = 'false';
    process.env.ESCALATED_GUEST_ROUTES = '0';
    const paths = await pathsFor({ ui: { enabled: true } });

    expect(widget(paths)).toEqual([]);
    expect(guest(paths)).toEqual([]);
  });

  it('lets the module options win over the env vars', async () => {
    process.env.ESCALATED_WIDGET_ENABLED = 'false';
    process.env.ESCALATED_GUEST_ROUTES = 'false';
    const paths = await pathsFor({
      ui: { enabled: true },
      widget: { enabled: true },
      guest: { routesEnabled: true },
    });

    expect(widget(paths).length).toBeGreaterThan(0);
    expect(guest(paths).length).toBeGreaterThan(0);
  });

  it('keeps the other public routes when both are off', async () => {
    const paths = await pathsFor({
      ui: { enabled: true },
      widget: { enabled: false },
      guest: { routesEnabled: false },
    });

    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /escalated/customer/kb/categories',
        'GET /escalated/kb',
        'POST /escalated/webhook/email/inbound',
      ]),
    );
  });
});
