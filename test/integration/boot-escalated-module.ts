import { ModuleMetadata } from '@nestjs/common';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscalatedModule } from '../../src/escalated.module';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

// otplib 13 depends on @scure/base, which ships ESM only and cannot be loaded by
// Jest's CommonJS runtime on Node 20/22. TwoFactorService is never exercised by
// the boot tests, so a stub keeps the real module graph importable.
jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verifySync: jest.fn(),
}));

export interface BootOptions {
  escalated?: EscalatedModuleOptions;
  /** Extra providers/imports the host app would contribute. */
  host?: Pick<ModuleMetadata, 'imports' | 'providers'>;
  /** Hook to override providers before compiling. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Builds the real `EscalatedModule` the way a host app imports it, against an
 * in-memory SQLite DataSource.
 *
 * The DataSource is registered but not initialized (`manualInitialization`), so
 * these tests exercise dependency injection, routing, guards and event wiring
 * without depending on the schema. Schema portability is covered separately.
 */
export async function bootEscalatedModule(options: BootOptions = {}): Promise<TestingModule> {
  let builder = Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'better-sqlite3',
        database: ':memory:',
        autoLoadEntities: true,
        synchronize: false,
        manualInitialization: true,
      }),
      EscalatedModule.forRoot(options.escalated),
      ...(options.host?.imports ?? []),
    ],
    providers: [...(options.host?.providers ?? [])],
  });

  if (options.configure) {
    builder = options.configure(builder);
  }

  return builder.compile();
}
