import { ColumnOptions, ColumnType } from 'typeorm';

/**
 * Host-application user key type.
 *
 * Escalated stores references to the *host* app's users (ticket requester,
 * assignee, reply author, activity causer, etc.). Those ids belong to the
 * host's user table, whose primary key may be an integer, a bigint, or a
 * UUID/string. This type selects the column shape Escalated uses to store
 * them so the package is compatible with non-integer-keyed hosts.
 */
export type UserKeyType = 'int' | 'bigint' | 'uuid' | 'string';

/**
 * Resolve the configured host user key type from the environment.
 *
 * `ESCALATED_USER_KEY_TYPE` accepts `int` (default), `bigint`, `uuid`, or
 * `string`/`varchar`. It is read from the environment rather than the module
 * options because TypeORM `@Column` decorators are evaluated at class-load
 * time, before `EscalatedModule.forRoot()` runs. Default is `int`, so existing
 * integer-keyed hosts get exactly the same schema as before.
 */
export function userKeyType(): UserKeyType {
  const raw = (process.env.ESCALATED_USER_KEY_TYPE ?? 'int').trim().toLowerCase();
  switch (raw) {
    case 'bigint':
      return 'bigint';
    case 'uuid':
      return 'uuid';
    case 'string':
    case 'varchar':
      return 'string';
    default:
      return 'int';
  }
}

/**
 * Build the TypeORM column type for a host-user-id column, matching the
 * configured {@link userKeyType}. `uuid` and `string` both map to a portable
 * `varchar(255)` so the same column can hold a UUID or a stringified integer
 * id across SQLite / Postgres / MySQL without a DB-native uuid type.
 */
export function userIdColumnType(): ColumnType {
  switch (userKeyType()) {
    case 'bigint':
      return 'bigint';
    case 'uuid':
    case 'string':
      return 'varchar';
    default:
      return 'int';
  }
}

/**
 * Column options for a host-user-id column. Spread caller options
 * (`nullable`, `unique`, …) over the resolved type. Use for every column that
 * stores a *host* user id; leave Escalated's own integer PKs/FKs alone.
 *
 * @example
 *   @Column(userIdColumn())               // not-null host user id
 *   @Column(userIdColumn({ nullable: true }))
 *   @Column(userIdColumn({ unique: true }))
 */
export function userIdColumn(options: ColumnOptions = {}): ColumnOptions {
  const type = userIdColumnType();
  const base: ColumnOptions = { type };
  if (type === 'varchar') {
    base.length = 255;
  }
  return { ...base, ...options };
}

/**
 * TypeScript type for a host user id value. A host id may arrive as a number
 * (classic integer keys) or a string (UUID/string keys, or anything that came
 * in over JSON), so all Escalated code paths that carry a host user id accept
 * both.
 */
export type UserId = number | string;
