import { pluginSlug, registerPlugin } from '../../src/plugins/plugin-definition';
import { registerPlugins } from '../../src/plugins/plugin-registry.service';

/** Plugins are checked when the module is configured, not on first use. */
describe('plugin registration', () => {
  it('derives the slug from the name as the contract does', () => {
    expect(pluginSlug('@escalated-dev/plugin-slack')).toBe('escalated-dev--plugin-slack');
    expect(pluginSlug('my plugin.v2')).toBe('my-plugin-v2');
    expect(pluginSlug('fragile')).toBe('fragile');
  });

  it('refuses two plugins with one slug, naming both', () => {
    expect(() =>
      registerPlugins([
        { name: '@acme/crm', version: '1.0.0' },
        { name: 'acme/crm', version: '2.0.0' },
      ]),
    ).toThrow('Plugins "@acme/crm" and "acme/crm" share the slug "acme--crm"');
  });

  it('refuses a plugin without a name, and malformed routes', () => {
    expect(() => registerPlugin({ version: '1.0.0' } as any)).toThrow('A plugin needs a name.');
    for (const key of ['GET settings', 'FETCH /settings', 'GET /a/../b', 'GET /a?b', 'GET']) {
      expect(() =>
        registerPlugin({ name: 'p', version: '1', endpoints: { [key]: async () => null } }),
      ).toThrow(`route "${key}"`);
    }
    expect(() =>
      registerPlugin({ name: 'p', version: '1', endpoints: { 'GET /x': {} as any } }),
    ).toThrow('has no handler');
  });
});
