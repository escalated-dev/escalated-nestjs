import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';
import { bootRouteTable } from './route-table';

jest.setTimeout(60000);

/**
 * Embedding the admin is optional and off by default (ADR
 * 2026-11-05-embeddable-admin). With no embed configuration the route table
 * must be exactly what it was before the feature existed: the snapshot in
 * test/fixtures/embed/default-routes.json was taken from the code before the
 * change (`UPDATE_EMBED_SNAPSHOT=1` rewrites it; only do that on purpose).
 */

const FIXTURE = join(__dirname, '..', 'fixtures', 'embed', 'default-routes.json');

const CONFIGS: Record<string, EscalatedModuleOptions> = {
  // Everything that registers routes: the screens and the newsletter admin.
  screens: { ui: { enabled: true }, enableNewsletters: true },
  // A headless install (the package default).
  headless: {},
};

describe('the route table with no embed configuration', () => {
  for (const [name, escalated] of Object.entries(CONFIGS)) {
    it(`is unchanged (${name})`, async () => {
      const { app, table } = await bootRouteTable(escalated);
      try {
        if (process.env.UPDATE_EMBED_SNAPSHOT === '1') {
          let all: Record<string, unknown> = {};
          try {
            all = JSON.parse(readFileSync(FIXTURE, 'utf8'));
          } catch {
            all = {};
          }
          all[name] = table;
          mkdirSync(dirname(FIXTURE), { recursive: true });
          writeFileSync(FIXTURE, JSON.stringify(all, null, 2) + '\n');
        }
        const snapshot = JSON.parse(readFileSync(FIXTURE, 'utf8'))[name];
        expect(table.routes.length).toBeGreaterThan(name === 'screens' ? 300 : 100);
        expect(table).toEqual(snapshot);
      } finally {
        await app.close();
      }
    });
  }
});
