import { buildTicket } from './ticket.factory';
import { buildWorkflow } from './workflow.factory';

describe('factories', () => {
  describe('buildTicket', () => {
    it('returns sensible defaults', () => {
      const t = buildTicket();
      expect(t.id).toBe(1);
      expect(t.priority).toBe('medium');
      expect(t.channel).toBe('widget');
      expect(t.contactId).toBeNull();
      expect(t.requesterId).toBe(0);
      expect(t.guestAccessToken).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('applies overrides', () => {
      const t = buildTicket({ subject: 'Overridden', priority: 'urgent', contactId: 7 });
      expect(t.subject).toBe('Overridden');
      expect(t.priority).toBe('urgent');
      expect(t.contactId).toBe(7);
    });

    it('generates a unique guestAccessToken per call', () => {
      const a = buildTicket();
      const b = buildTicket();
      expect(a.guestAccessToken).not.toBe(b.guestAccessToken);
    });
  });

  describe('buildWorkflow', () => {
    it('returns an active ticket.created workflow with empty rules', () => {
      const w = buildWorkflow();
      expect(w.isActive).toBe(true);
      expect(w.triggerEvent).toBe('ticket.created');
      expect(w.actions).toEqual([]);
      expect(w.conditions).toEqual({});
      expect(w.stopOnMatch).toBe(false);
    });

    it('applies overrides including conditions and actions', () => {
      const w = buildWorkflow({
        triggerEvent: 'ticket.updated',
        conditions: { all: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
        actions: [{ type: 'assign_agent', value: '7' }],
        stopOnMatch: true,
      });
      expect(w.triggerEvent).toBe('ticket.updated');
      expect(w.actions).toHaveLength(1);
      expect(w.actions[0].type).toBe('assign_agent');
      expect(w.stopOnMatch).toBe(true);
    });
  });
});
