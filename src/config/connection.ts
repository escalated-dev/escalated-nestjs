import { Provider } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';

/**
 * Bind Escalated's entities to a named TypeORM DataSource.
 *
 * Every service in the package injects its repository with a plain
 * `@InjectRepository(Ticket)`, and that decorator resolves the token for the
 * DEFAULT DataSource at class-definition time. There are 164 of them, and the
 * connection is a runtime module option, so the name simply is not knowable
 * where the decorator is written.
 *
 * Rather than thread a name through every decorator — which would also make
 * the package impossible to configure per host — the entities are registered
 * against the named DataSource and the default repository token is then
 * aliased to the named one. `@InjectRepository(Ticket)` keeps resolving, and
 * what it resolves to is a repository on the host's chosen connection.
 *
 * Nothing is aliased when no connection is configured: `forFeature(entities)`
 * already provides those exact tokens, and re-providing them would be a
 * provider resolving to itself.
 */
export function escalatedRepositoryProviders(
  entities: EntityClassOrSchema[],
  connection?: string,
): Provider[] {
  if (!connection) {
    return [];
  }

  return entities.map((entity) => ({
    provide: getRepositoryToken(entity),
    useFactory: (dataSource: DataSource) => dataSource.getRepository(entity as never),
    inject: [getDataSourceToken(connection)],
  }));
}
