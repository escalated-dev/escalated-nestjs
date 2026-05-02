import { Observable, of } from 'rxjs';
import { I18nLoader, I18nTranslation } from 'nestjs-i18n';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ChainedI18nLoader
 *
 * Loads translations from multiple sources, deep-merging per language
 * so that later sources override earlier ones key-by-key. Sources that
 * don't resolve (missing dir, package not installed yet) are skipped
 * silently — this lets host apps consume the central package without
 * requiring it to be present at build time.
 *
 * The expected on-disk shape for every source is:
 *
 *   <root>/<lang>/<namespace>.json
 *
 * which matches both `@escalated-dev/locale` and the local override
 * tree under `src/i18n/overrides/`.
 *
 * Note: this is the canonical NestJS reference implementation. Other
 * host plugins (Laravel, Rails, Django, …) mirror this overlay pattern
 * in their own framework idiom.
 */
export interface ChainedI18nLoaderOptions {
  sourceRoots: string[];
}

export class ChainedI18nLoader extends I18nLoader {
  private readonly sourceRoots: string[];

  constructor(options: ChainedI18nLoaderOptions) {
    super();
    this.sourceRoots = options?.sourceRoots ?? [];
  }

  languages(): Promise<string[]> | Observable<string[]> {
    const seen = new Set<string>();
    for (const root of this.sourceRoots) {
      if (!root || !fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) seen.add(entry.name);
      }
    }
    return of([...seen]);
  }

  load(): Promise<I18nTranslation> | Observable<I18nTranslation> {
    const result: I18nTranslation = {};

    for (const root of this.sourceRoots) {
      if (!root || !fs.existsSync(root)) continue;

      for (const langDir of fs.readdirSync(root, { withFileTypes: true })) {
        if (!langDir.isDirectory()) continue;
        const lang = langDir.name;
        const langPath = path.join(root, lang);

        for (const file of fs.readdirSync(langPath)) {
          if (!file.endsWith('.json')) continue;
          const namespace = path.basename(file, '.json');
          let parsed: any;
          try {
            parsed = JSON.parse(fs.readFileSync(path.join(langPath, file), 'utf8'));
          } catch {
            continue;
          }
          result[lang] = result[lang] || {};
          (result[lang] as any)[namespace] = deepMerge(
            (result[lang] as any)[namespace] || {},
            parsed,
          );
        }
      }
    }

    return of(result);
  }
}

function deepMerge(base: any, override: any): any {
  if (
    base &&
    override &&
    typeof base === 'object' &&
    typeof override === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(override)
  ) {
    const out: any = { ...base };
    for (const key of Object.keys(override)) {
      out[key] = deepMerge(base[key], override[key]);
    }
    return out;
  }
  return override === undefined ? base : override;
}

/**
 * Resolves the on-disk path of `@escalated-dev/locale`'s translation
 * tree. Returns null if the package is not installed (e.g. during
 * bootstrap before v0.1.0 is published).
 */
export function resolveCentralLocaleRoot(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkgJson = require.resolve('@escalated-dev/locale/package.json');
    return path.join(path.dirname(pkgJson), 'translations');
  } catch {
    return null;
  }
}
