import {
  TicketActionRegistry,
  ArrayTicketAction,
} from '../../src/services/ticket-action-registry.service';

describe('TicketActionRegistry', () => {
  const ticket = { id: 1, reference: 'TK-1' };
  const user = { id: 9, name: 'Agent' };

  it('registers and finds actions by key', () => {
    const registry = new TicketActionRegistry();
    registry.register({ key: 'sync-crm', label: 'Sync CRM' });

    expect(registry.find('sync-crm')).not.toBeNull();
    expect(registry.find('missing')).toBeNull();
  });

  it('serializes visible actions for a ticket with sensible defaults', () => {
    const registry = new TicketActionRegistry();
    registry.register({ key: 'sync-crm', label: 'Sync CRM' });

    const actions = registry.forTicket(ticket, user);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      key: 'sync-crm',
      label: 'Sync CRM',
      variant: 'secondary',
      confirmation: null,
      disabled: false,
      metadata: {},
    });
  });

  it('omits actions whose visible() is false', () => {
    const registry = new TicketActionRegistry();
    registry.register({ key: 'hidden', label: 'Hidden', visible: false });
    registry.register({ key: 'shown', label: 'Shown' });

    const keys = registry.forTicket(ticket, user).map((a) => a.key);
    expect(keys).toEqual(['shown']);
  });

  it('marks disabled actions but still lists them', () => {
    const registry = new TicketActionRegistry();
    registry.register({ key: 'locked', label: 'Locked', enabled: false });

    expect(registry.forTicket(ticket, user)[0].disabled).toBe(true);
  });

  it('resolves value-or-function fields lazily with ticket + user', () => {
    const action = new ArrayTicketAction({
      key: 'dyn',
      label: (t: any) => `Sync ${t.reference}`,
      visible: (_t: any, u: any) => u.id === 9,
      metadata: () => ({ icon: 'refresh-cw' }),
      confirmation: () => 'Are you sure?',
    });

    expect(action.label(ticket, user)).toBe('Sync TK-1');
    expect(action.visible(ticket, user)).toBe(true);
    expect(action.visible(ticket, { id: 1 })).toBe(false);
    expect(action.metadata(ticket, user)).toEqual({ icon: 'refresh-cw' });
    expect(action.confirmation(ticket, user)).toBe('Are you sure?');
  });

  it('throws when a config action is missing key or label', () => {
    expect(() => new ArrayTicketAction({ key: '', label: 'x' } as any)).toThrow(/key/);
  });
});
