import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AppModule } from './app.module';
import { User } from './user.entity';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });

  const ds = app.get<DataSource>(getDataSourceToken());
  const userRepo = ds.getRepository(User);

  console.log('[seed] truncating users');
  await ds.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');

  const users = await userRepo.save([
    { name: 'Alice Admin', email: 'alice@demo.test', is_admin: true, is_agent: true },
    { name: 'Bob Agent', email: 'bob@demo.test', is_admin: false, is_agent: true },
    { name: 'Carol Agent', email: 'carol@demo.test', is_admin: false, is_agent: true },
    { name: 'Dan Agent', email: 'dan@demo.test', is_admin: false, is_agent: true },
    { name: 'Frank Customer', email: 'frank@acme.example', is_admin: false, is_agent: false },
    { name: 'Grace Customer', email: 'grace@acme.example', is_admin: false, is_agent: false },
    { name: 'Henry Customer', email: 'henry@globex.example', is_admin: false, is_agent: false },
  ]);

  console.log(`[seed] created ${users.length} users`);

  // Departments
  console.log('[seed] creating 2 departments');
  await ds.query(`
    INSERT INTO escalated_departments (name, slug, description, is_active, created_at, updated_at)
    VALUES
      ('Support', 'support', 'General support.', true, NOW(), NOW()),
      ('Billing', 'billing', 'Invoices + refunds.', true, NOW(), NOW())
    ON CONFLICT DO NOTHING
  `).catch((e) => console.warn('[seed] departments skipped:', e.message));

  // Tags
  console.log('[seed] creating tags');
  await ds.query(`
    INSERT INTO escalated_tags (name, slug, color, created_at, updated_at)
    VALUES ('Bug', 'bug', '#ef4444', NOW(), NOW()),
           ('Refund', 'refund', '#10b981', NOW(), NOW()),
           ('Billing', 'billing', '#f59e0b', NOW(), NOW())
    ON CONFLICT DO NOTHING
  `).catch((e) => console.warn('[seed] tags skipped:', e.message));

  // Tickets
  console.log('[seed] creating tickets');
  const subjects = [
    'Unable to log in - password reset email not arriving',
    'Feature request: bulk-export tickets as CSV',
    'Refund for duplicate charge on invoice #A-2847',
    'Integration with Slack stopped posting after last update',
    'Getting 502 from API endpoint /v2/contacts',
    'SSO configuration questions',
    'Cannot upload files larger than 10MB',
    'Billing: can we switch from monthly to annual mid-cycle?',
  ];
  const statuses = ['open', 'in_progress', 'resolved', 'closed'];
  const priorities = ['low', 'medium', 'high', 'urgent'];

  for (let i = 0; i < subjects.length; i++) {
    const customer = users[4 + (i % 3)];
    const agent = users[1 + (i % 3)];
    const ref = `ESC-${String(i + 1).padStart(5, '0')}`;
    try {
      await ds.query(
        `INSERT INTO escalated_tickets
         (reference, subject, description, status, priority, channel,
          requester_type, requester_id, assigned_to, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'web', 'User', $6, $7, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [ref, subjects[i], `Demo ticket seeded on boot. Status: ${statuses[i % statuses.length]}`,
         statuses[i % statuses.length], priorities[i % priorities.length], customer.id, agent.id],
      );
    } catch (e) {
      console.warn(`[seed] ticket ${ref} skipped:`, e.message);
    }
  }

  console.log('[seed] done');
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
