/**
 * A `LIKE` pattern that finds `term` anywhere, taking `%` and `_` in it
 * literally: they (and the escape character itself) are escaped with `!`,
 * which every supported database accepts in `ESCAPE '!'`. Lower-cased, for
 * `LOWER(column) LIKE :pattern ESCAPE '!'`, which ignores case on PostgreSQL
 * too.
 */
export function containsPattern(term: string): string {
  return `%${term.toLowerCase().replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

/** `LOWER(column) LIKE :parameter ESCAPE '!'`. */
export function likeContains(column: string, parameter: string): string {
  return `LOWER(${column}) LIKE :${parameter} ESCAPE '!'`;
}
