import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { escalatedRepositoryProviders } from '../../src/config/connection';
import { Ticket } from '../../src/entities/ticket.entity';
import { Reply } from '../../src/entities/reply.entity';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

/**
 * Every service injects its repository with a plain `@InjectRepository(X)`,
 * which binds the DEFAULT DataSource's token at class-definition time. There
 * are 164 of them and the connection is a runtime option, so the name cannot
 * be written into the decorator.
 *
 * Escalated therefore registers its entities against the named DataSource and
 * aliases the default token onto it. These specs pin that wiring, because if
 * the alias is wrong the failure is not a compile error — it is the package
 * quietly reading and writing the wrong database.
 */
describe('escalatedRepositoryProviders', () => {
  it('provides nothing when no connection is configured', () => {
    // forFeature() already provides these exact tokens for the default
    // DataSource; re-providing them would be a provider resolving to itself.
    expect(escalatedRepositoryProviders([Ticket, Reply])).toEqual([]);
    expect(escalatedRepositoryProviders([Ticket, Reply], undefined)).toEqual([]);
    expect(escalatedRepositoryProviders([Ticket, Reply], '')).toEqual([]);
  });

  it('aliases the default repository token onto the named data source', () => {
    const providers = escalatedRepositoryProviders([Ticket, Reply], 'support');

    expect(providers).toHaveLength(2);

    const ticketProvider = providers[0] as {
      provide: unknown;
      inject: unknown[];
      useFactory: (dataSource: DataSource) => unknown;
    };

    // The token a bare @InjectRepository(Ticket) asks for...
    expect(ticketProvider.provide).toEqual(getRepositoryToken(Ticket));
    // ...resolved from the host's named DataSource, not the default one.
    expect(ticketProvider.inject).toEqual([getDataSourceToken('support')]);
  });

  it('hands back the repository the named data source owns', () => {
    const repository = { marker: 'from-support-datasource' };
    const dataSource = { getRepository: jest.fn().mockReturnValue(repository) };

    const [ticketProvider] = escalatedRepositoryProviders([Ticket], 'support') as Array<{
      useFactory: (dataSource: unknown) => unknown;
    }>;

    expect(ticketProvider.useFactory(dataSource)).toBe(repository);
    expect(dataSource.getRepository).toHaveBeenCalledWith(Ticket);
  });

  it('covers every entity it is given, so none is left on the default connection', () => {
    const entities = [Ticket, Reply];
    const providers = escalatedRepositoryProviders(entities, 'support') as Array<{
      provide: unknown;
    }>;

    expect(providers.map((provider) => provider.provide)).toEqual(
      entities.map((entity) => getRepositoryToken(entity)),
    );
  });
});

describe('EscalatedModuleOptions.connection', () => {
  it('is optional, so an unconfigured host keeps the default data source', () => {
    const options: EscalatedModuleOptions = {};

    expect(options.connection).toBeUndefined();
  });

  it('names a data source when the host partitions its database', () => {
    const options: EscalatedModuleOptions = { connection: 'support' };

    expect(options.connection).toBe('support');
  });
});
