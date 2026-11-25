import { solvedTimestamps } from '../../src/entities/status-category';

describe('solvedTimestamps', () => {
  const now = new Date('2026-11-25T09:00:00.000Z');
  const earlier = new Date('2026-11-01T10:00:00.000Z');
  const open = { slug: 'open', isClosed: false };
  const resolved = { slug: 'resolved', isClosed: true };
  const customSolved = { slug: 'fixed', category: 'solved', isClosed: false };

  it('stamps both on entering a solved status', () => {
    expect(solvedTimestamps({}, resolved, now)).toEqual({ resolvedAt: now, closedAt: now });
    expect(solvedTimestamps({}, customSolved, now)).toEqual({ resolvedAt: now, closedAt: now });
  });

  it('keeps the stamps of a ticket that is already closed', () => {
    expect(solvedTimestamps({ resolvedAt: earlier, closedAt: earlier }, resolved, now)).toEqual({});
  });

  it('clears both when a solved ticket moves to an open status (a reopen)', () => {
    expect(solvedTimestamps({ resolvedAt: earlier, closedAt: earlier }, open, now)).toEqual({
      resolvedAt: null,
      closedAt: null,
    });
    expect(solvedTimestamps({ resolvedAt: earlier, closedAt: null }, open, now)).toEqual({
      resolvedAt: null,
      closedAt: null,
    });
  });

  it('writes nothing for an open ticket staying open, or an unknown status', () => {
    expect(solvedTimestamps({ resolvedAt: null, closedAt: null }, open, now)).toEqual({});
    expect(solvedTimestamps({ resolvedAt: earlier, closedAt: earlier }, null, now)).toEqual({});
  });
});
