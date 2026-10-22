import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import manifest from './fixtures/escalated-pages.json';

/**
 * Every page name this package renders resolves to a component in
 * `@escalated-dev/escalated`.
 *
 * Inertia resolving a name to nothing is not an error. The response is a 200,
 * the resolver returns undefined, Vue renders nothing, and the panel comes up
 * blank -- which reads as a permissions problem or an empty dataset. Several
 * screens shipped that way across this portfolio before anyone noticed.
 *
 * Neither repo's tests can see it alone: a controller test asserts a status,
 * and the frontend never hears the name. This is the comparison, against the
 * manifest the frontend package publishes and this repo vendors at
 * test/fixtures/escalated-pages.json.
 *
 * Adding a screen goes: component into the frontend, frontend release, refresh
 * the fixture, then render the name here. In that order, or it ships blank.
 */
const SHIPPED: string[] = manifest.pages;

const PAGE_NAME = /['"`](Escalated\/[A-Za-z0-9/_]+)['"`]/g;

/**
 * Page names rendered anywhere in src/, mapped to the files that render them,
 * so a failure can name the file and not only the string.
 */
function renderedPages(): Map<string, Set<string>> {
  const root = join(__dirname, '..', 'src');
  const found = new Map<string, Set<string>>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);

      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }

      if (!entry.endsWith('.ts')) continue;

      for (const [, name] of readFileSync(path, 'utf8').matchAll(PAGE_NAME)) {
        if (!found.has(name)) found.set(name, new Set());
        found.get(name)!.add(relative(root, path).split(sep).join('/'));
      }
    }
  };

  walk(root);

  return found;
}

function explain(missing: string[], rendered: Map<string, Set<string>>): string {
  return [
    'these page names have no component in @escalated-dev/escalated, so they render a blank panel:',
    ...missing.map((name) => `  ${name}  (${[...rendered.get(name)!].join(', ')})`),
    '',
    'Either the name is wrong, or the component has not been released yet.',
    'If it has been: refresh test/fixtures/escalated-pages.json from the package.',
  ].join('\n');
}

/**
 * Shipped pages this package does not render yet. Serving one means taking it
 * off this list, and a page the frontend adds lands here until a screen
 * serves it, so the list is always the exact remaining work.
 */
const NOT_YET_RENDERED: string[] = [
  'Escalated/Admin/AuditLog/Index',
  'Escalated/Admin/Automations/Form',
  'Escalated/Admin/Automations/Index',
  'Escalated/Admin/BusinessHours/Form',
  'Escalated/Admin/BusinessHours/Index',
  'Escalated/Admin/Capacity/Index',
  'Escalated/Admin/CustomFields/Form',
  'Escalated/Admin/CustomFields/Index',
  'Escalated/Admin/CustomObjects/Form',
  'Escalated/Admin/CustomObjects/Index',
  'Escalated/Admin/CustomObjects/Records',
  'Escalated/Admin/Import/Connect',
  'Escalated/Admin/Import/Index',
  'Escalated/Admin/Import/Mapping',
  'Escalated/Admin/Import/Progress',
  'Escalated/Admin/Import/Review',
  'Escalated/Admin/Plugins/Index',
  'Escalated/Admin/Reports',
  'Escalated/Admin/Reports/AgentDetail',
  'Escalated/Admin/Reports/AgentMetrics',
  'Escalated/Admin/Reports/AgentRanking',
  'Escalated/Admin/Reports/Cohorts',
  'Escalated/Admin/Reports/Comparison',
  'Escalated/Admin/Reports/CsatReport',
  'Escalated/Admin/Reports/Dashboard',
  'Escalated/Admin/Reports/ResolutionTimes',
  'Escalated/Admin/Reports/ResponseTimes',
  'Escalated/Admin/Reports/SlaReport',
  'Escalated/Admin/Reports/SlaTrends',
  'Escalated/Admin/Settings/CsatSettings',
  'Escalated/Admin/Settings/DataRetention',
  'Escalated/Admin/Settings/DatabaseConnection',
  'Escalated/Admin/Settings/EmailSettings',
  'Escalated/Admin/Settings/PublicTickets',
  'Escalated/Admin/Settings/Sandbox',
  'Escalated/Admin/Settings/SsoSettings',
  'Escalated/Admin/Settings/TwoFactor',
  'Escalated/Admin/Skills/Form',
  'Escalated/Admin/Skills/Index',
  'Escalated/Admin/Users/Index',
  'Escalated/Admin/Workflows/Builder',
  'Escalated/Auth/TwoFactorChallenge',
  'Escalated/Error',
  'Escalated/Plugin/Page',
];

/** Screen tests: HTTP tests that assert a page's component name and props. */
function screenTests(): string {
  const dir = join(__dirname, 'integration');
  return readdirSync(dir)
    .filter((file) => /^ui-.*\.spec\.ts$/.test(file))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n');
}

describe('page name parity', () => {
  it('renders only page names the frontend ships', () => {
    const rendered = renderedPages();

    expect(rendered.size).toBeGreaterThan(0);

    const missing = [...rendered.keys()].filter((name) => !SHIPPED.includes(name)).sort();

    // Asserted as a string rather than an array: jest has no message argument,
    // and a diff of page names says nothing about what to do next.
    expect(missing.length ? explain(missing, rendered) : '').toBe('');
  });

  it('lists exactly the shipped pages not rendered yet', () => {
    const rendered = renderedPages();
    const unrendered = SHIPPED.filter((name) => !rendered.has(name)).sort();

    expect(unrendered).toEqual([...NOT_YET_RENDERED].sort());
  });

  it('covers every screen with an HTTP test of its component and props', () => {
    const tests = screenTests();
    const untested = [...renderedPages()]
      // The newsletter screens predate the protocol; their controller tests cover them.
      .filter(([, files]) => [...files].some((file) => !file.startsWith('controllers/newsletter/')))
      .map(([name]) => name)
      .filter((name) => !tests.includes(`'${name}'`))
      .sort();

    expect(untested).toEqual([]);
  });

  it('has a manifest that is present and looks like one', () => {
    // A fixture gone missing or empty would make the test above pass by
    // comparing against nothing.
    expect(Array.isArray(SHIPPED)).toBe(true);
    expect(SHIPPED.length).toBeGreaterThan(50);
    expect(SHIPPED.every((name) => name.startsWith('Escalated/'))).toBe(true);
  });
});
