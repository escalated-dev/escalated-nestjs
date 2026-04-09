import { WorkflowEngineService } from '../../src/services/workflow-engine.service';

describe('WorkflowEngineService', () => {
  const engine = new WorkflowEngineService();
  const ticket = { status: 'open', priority: 'medium', subject: 'Billing issue', description: '', reference: 'ESC-001' };

  it('evaluates AND conditions', () => {
    expect(engine.evaluateConditions({ all: [{ field: 'status', operator: 'equals', value: 'open' }, { field: 'priority', operator: 'equals', value: 'medium' }] }, ticket)).toBe(true);
  });

  it('evaluates OR conditions', () => {
    expect(engine.evaluateConditions({ any: [{ field: 'status', operator: 'equals', value: 'closed' }, { field: 'status', operator: 'equals', value: 'open' }] }, ticket)).toBe(true);
  });

  it('contains operator', () => {
    expect(engine.applyOperator('contains', 'Billing issue', 'Billing')).toBe(true);
  });

  it('is_empty operator', () => {
    expect(engine.applyOperator('is_empty', '', '')).toBe(true);
  });

  it('interpolates variables', () => {
    expect(engine.interpolateVariables('Ticket {{reference}} is {{status}}', ticket)).toBe('Ticket ESC-001 is open');
  });

  it('dry run returns preview', () => {
    const result = engine.dryRun({ all: [{ field: 'status', operator: 'equals', value: 'open' }] }, [{ type: 'add_note', value: 'Note for {{reference}}' }], ticket);
    expect(result.matched).toBe(true);
    expect(result.actions[0].value).toBe('Note for ESC-001');
  });
});
