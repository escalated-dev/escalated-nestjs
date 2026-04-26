/**
 * Build a plain-object Contact shape for tests that mock the repository layer.
 */
export function buildContact(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 1,
    email: 'alice@example.com',
    name: 'Alice',
    userId: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
