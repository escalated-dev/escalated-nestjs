import { MigrationInterface, QueryRunner } from 'typeorm';
import { seedRolesAndPermissions } from '../access/permission-seed';

/**
 * Seeds the permissions and the system roles (`admin`, `agent`,
 * `light_agent`) with escalated-laravel's slugs, which the roles &
 * permissions switch enforces (ADR 2026-10-29-configurable-access-features).
 * Data only: the role tables already exist. Idempotent, and safe to run while
 * the switch is off. Custom roles and their permissions are kept.
 */
export class RolesAndPermissions1793404800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await seedRolesAndPermissions(runner.manager);
  }

  async down(): Promise<void> {
    // Seeded rows are left in place: roles may already be assigned to users.
  }
}
