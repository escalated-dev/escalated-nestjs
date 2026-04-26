/**
 * Build a plain-object Workflow shape for tests that mock the repository layer.
 */
export function buildWorkflow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 1,
    name: 'Test Workflow',
    description: null,
    triggerEvent: 'ticket.created',
    conditions: {},
    actions: [],
    position: 0,
    isActive: true,
    stopOnMatch: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
