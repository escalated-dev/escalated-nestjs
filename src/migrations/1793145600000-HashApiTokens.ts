import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashApiToken } from '../services/api-token.service';

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * Replaces each stored plain API token with its SHA-256 hex digest, the value
 * `ApiTokenService` and `ApiTokenGuard` now look tokens up by. Clients keep
 * sending the same plain token, so issued tokens keep working. Values that are
 * already a 64-character hex digest (tokens issued by this release) are left
 * alone, so the migration is safe to run more than once. The schema does not
 * change. Register with the host DataSource and run before upgrading.
 *
 * `down()` does nothing: a digest cannot be turned back into the token.
 */
export class HashApiTokens1793145600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const metadata = runner.connection.getMetadata('ApiToken');
    const driver = runner.connection.driver;
    const table = driver.escape(metadata.tablePath);
    const id = driver.escape(metadata.findColumnWithPropertyName('id')!.databaseName);
    const token = driver.escape(metadata.findColumnWithPropertyName('token')!.databaseName);

    const rows: Array<{ id: number | string; token: string | null }> = await runner.query(
      `SELECT ${id} AS ${driver.escape('id')}, ${token} AS ${driver.escape('token')} FROM ${table}`,
    );

    for (const row of rows) {
      if (row.token == null || DIGEST.test(row.token)) continue;
      const [sql, parameters] = driver.escapeQueryWithParameters(
        `UPDATE ${table} SET ${token} = :digest WHERE ${id} = :id AND ${token} = :plain`,
        { digest: hashApiToken(row.token), id: row.id, plain: row.token },
      );
      await runner.query(sql, parameters);
    }
  }

  async down(_runner: QueryRunner): Promise<void> {
    // Irreversible: the plain tokens are not recoverable from their digests.
  }
}
