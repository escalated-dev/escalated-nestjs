import { WorkflowEngineService } from '../../src/services/workflow-engine.service';

describe('WorkflowEngineService', () => {
  const engine = new WorkflowEngineService();
  const ticket = {
    status: 'open',
    priority: 'medium',
    subject: 'Billing issue',
    description: '',
    reference: 'ESC-001',
  };

  it('evaluates AND conditions', () => {
    expect(
      engine.evaluateConditions(
        {
          all: [
            { field: 'status', operator: 'equals', value: 'open' },
            { field: 'priority', operator: 'equals', value: 'medium' },
          ],
        },
        ticket,
      ),
    ).toBe(true);
  });

  it('evaluates OR conditions', () => {
    expect(
      engine.evaluateConditions(
        {
          any: [
            { field: 'status', operator: 'equals', value: 'closed' },
            { field: 'status', operator: 'equals', value: 'open' },
          ],
        },
        ticket,
      ),
    ).toBe(true);
  });

  it('contains operator', () => {
    expect(engine.applyOperator('contains', 'Billing issue', 'Billing')).toBe(true);
  });

  it('is_empty operator', () => {
    expect(engine.applyOperator('is_empty', '', '')).toBe(true);
  });

  it('interpolates variables', () => {
    expect(engine.interpolateVariables('Ticket {{reference}} is {{status}}', ticket)).toBe(
      'Ticket ESC-001 is open',
    );
  });

  it('dry run returns preview', () => {
    const result = engine.dryRun(
      { all: [{ field: 'status', operator: 'equals', value: 'open' }] },
      [{ type: 'add_note', value: 'Note for {{reference}}' }],
      ticket,
    );
    expect(result.matched).toBe(true);
    expect(result.actions[0].value).toBe('Note for ESC-001');
  });

  it('reads tags as a list and assigned_to as the assignee', () => {
    const ticket = { tags: ['VIP', 'vip'], assigneeId: '21' };
    const check = (field: string, operator: string, value: string) =>
      engine.evaluateConditions({ all: [{ field, operator, value }] }, ticket);
    expect(check('tags', 'contains', 'vip')).toBe(true);
    expect(check('tags', 'not_contains', 'billing')).toBe(true);
    expect(check('tags', 'is_empty', '')).toBe(false);
    expect(check('assigned_to', 'equals', '21')).toBe(true);
    expect(
      engine.evaluateConditions(
        { all: [{ field: 'tags', operator: 'is_empty', value: '' }] },
        { tags: [] },
      ),
    ).toBe(true);
  });
});
