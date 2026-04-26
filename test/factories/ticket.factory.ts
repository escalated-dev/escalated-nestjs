import { v4 as uuid } from 'uuid';

/**
 * Build a plain-object ticket shape for tests that mock the repository layer.
 * Not a real TypeORM entity — just a structural match for `Ticket`.
 */
export function buildTicket(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 1,
    referenceNumber: 'TK-TEST001',
    subject: 'Test',
    description: 'Description',
    priority: 'medium',
    channel: 'widget',
    statusId: 1,
    requesterId: 0,
    contactId: null,
    assigneeId: null,
    departmentId: null,
    guestAccessToken: uuid(),
    tags: [],
    isMerged: false,
    ...overrides,
  };
}
