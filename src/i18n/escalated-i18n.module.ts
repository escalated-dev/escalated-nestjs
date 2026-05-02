import { DynamicModule, Module } from '@nestjs/common';
import { I18nModule, HeaderResolver, AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
import * as path from 'path';
import { ChainedI18nLoader, resolveCentralLocaleRoot } from './chained-loader';

export interface EscalatedI18nOptions {
  /** Fallback language when none is detected. Defaults to `en`. */
  fallbackLanguage?: string;

  /**
   * Absolute path to a host-app override directory. Files placed here
   * win over both the central package and the in-repo overrides.
   * Optional — host apps that don't need to override anything can omit it.
   */
  hostOverridesPath?: string;
}

/**
 * Wires `nestjs-i18n` with a chained loader: central package first,
 * the in-repo `src/i18n/overrides/` tree second, and an optional
 * host-app override path last. Later sources override earlier ones
 * key-by-key.
 *
 * This is the canonical pattern other host plugins mirror.
 */
@Module({})
export class EscalatedI18nModule {
  static forRoot(options: EscalatedI18nOptions = {}): DynamicModule {
    const fallbackLanguage = options.fallbackLanguage ?? 'en';

    const sources: string[] = [];

    const central = resolveCentralLocaleRoot();
    if (central) sources.push(central);

    sources.push(path.join(__dirname, 'overrides'));

    if (options.hostOverridesPath) sources.push(options.hostOverridesPath);

    return {
      module: EscalatedI18nModule,
      imports: [
        I18nModule.forRoot({
          fallbackLanguage,
          loader: ChainedI18nLoader,
          loaderOptions: { sourceRoots: sources },
          resolvers: [
            { use: QueryResolver, options: ['lang', 'locale'] },
            new HeaderResolver(['x-lang']),
            AcceptLanguageResolver,
          ],
        } as any),
      ],
      exports: [I18nModule],
    };
  }
}
