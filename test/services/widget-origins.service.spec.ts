import {
  WidgetOriginsService,
  invalidOriginEntries,
  normalizeOriginPattern,
  requestCrossOrigin,
} from '../../src/services/widget-origins.service';

describe('widget origins', () => {
  describe('normalizeOriginPattern', () => {
    it.each<[string, string | null]>([
      ['https://Shop.Example.com', 'https://shop.example.com'],
      ['https://shop.example.com/', 'https://shop.example.com'],
      ['https://shop.example.com:443', 'https://shop.example.com'],
      ['http://shop.example.com:80', 'http://shop.example.com'],
      ['http://localhost:5173', 'http://localhost:5173'],
      ['  https://shop.example.com  ', 'https://shop.example.com'],
      ['https://*.example.com', 'https://*.example.com'],
      ['https://*.example.com:8443', 'https://*.example.com:8443'],
      ['https://shop.example.com/checkout', null],
      ['https://shop.example.com?x=1', null],
      ['https://shop.example.com#top', null],
      ['shop.example.com', null],
      ['*', null],
      ['https://*', null],
      ['https://a.*.example.com', null],
      ['ftp://shop.example.com', null],
      ['https://user@shop.example.com', null],
      ['', null],
    ])('normalises %j to %j', (entry, expected) => {
      expect(normalizeOriginPattern(entry)).toBe(expected);
    });
  });

  describe('invalidOriginEntries', () => {
    it('lists every entry that is not a bare origin, split on newlines and commas', () => {
      expect(
        invalidOriginEntries('https://shop.example.com, https://bad.example.com/path\n*\n\n'),
      ).toEqual(['https://bad.example.com/path', '*']);
      expect(invalidOriginEntries(['https://shop.example.com', 'https://*.brand.test'])).toEqual(
        [],
      );
    });
  });

  describe('WidgetOriginsService', () => {
    const settings = (value: string | null = null) => ({
      get: jest.fn(async (_key: string, fallback?: string) => value ?? fallback ?? null),
    });
    const service = (widgetOrigins: string[], setting: string | null = null) =>
      new WidgetOriginsService({ widgetOrigins }, settings(setting) as any);

    it.each<[string, boolean]>([
      ['https://shop.example.com', true],
      ['https://SHOP.example.com:443', true],
      ['http://shop.example.com', false],
      ['https://shop.example.com:8443', false],
      ['https://help.brand.test', true],
      ['https://a.b.brand.test', true],
      ['https://brand.test', false],
      ['https://notbrand.test', false],
      ['https://help.brand.test.evil.com', false],
      ['http://help.brand.test', false],
      ['http://localhost:5173', true],
      ['http://localhost', false],
      ['null', false],
    ])('matches %s: %s', async (origin, allowed) => {
      const origins = service([
        'https://shop.example.com',
        'https://*.brand.test',
        'http://localhost:5173',
      ]);

      await expect(origins.allows(origin)).resolves.toBe(allowed);
    });

    it('never treats a bare * as allowing every site', async () => {
      await expect(service(['*']).allows('https://shop.example.com')).resolves.toBe(false);
    });

    it('merges the config list, the environment and the admin setting', async () => {
      process.env.ESCALATED_WIDGET_ALLOWED_ORIGINS = 'https://docs.example.com,';
      try {
        const origins = service(
          ['https://shop.example.com'],
          'https://blog.example.com, https://bad.example.com/path\n',
        );

        await expect(origins.patterns()).resolves.toEqual([
          'https://shop.example.com',
          'https://docs.example.com',
          'https://blog.example.com',
        ]);
      } finally {
        delete process.env.ESCALATED_WIDGET_ALLOWED_ORIGINS;
      }
    });

    it('does not read the settings store when the config list already allows the site', async () => {
      const store = settings('https://blog.example.com');
      const origins = new WidgetOriginsService(
        { widgetOrigins: ['https://shop.example.com'] },
        store as any,
      );

      await expect(origins.allows('https://shop.example.com')).resolves.toBe(true);
      expect(store.get).not.toHaveBeenCalled();
    });
  });

  describe('requestCrossOrigin', () => {
    const request = (origin?: string, protocol = 'https') => ({
      protocol,
      headers: { host: 'help.example.com', ...(origin === undefined ? {} : { origin }) },
    });

    it.each<[string | undefined, string | null]>([
      [undefined, null],
      ['', null],
      ['null', null],
      ['https://help.example.com', null],
      ['https://help.example.com:443', null],
      ['https://shop.example.com', 'https://shop.example.com'],
      ['https://SHOP.example.com', 'https://shop.example.com'],
      ['http://help.example.com', 'http://help.example.com'],
      ['not a url', null],
    ])('reports Origin %j as %j', (origin, expected) => {
      expect(requestCrossOrigin(request(origin))).toBe(expected);
    });
  });
});
