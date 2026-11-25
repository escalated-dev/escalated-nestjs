import { Logger, UnauthorizedException } from '@nestjs/common';
import { requireUserId } from '../../src/config/request-user';
import { EscalatedSetupCheck, setupProblems } from '../../src/config/setup-check';

describe('requireUserId (the host user contract)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('returns req.user.id, else the API token user', () => {
    expect(requireUserId({ user: { id: 7 } })).toBe(7);
    expect(requireUserId({ user: { id: 'u-1' } })).toBe('u-1');
    expect(requireUserId({ apiUserId: 9 })).toBe(9);
  });

  it('names the contract when the host user has no id', () => {
    let thrown: unknown;
    try {
      requireUserId({ user: { sub: 'abc', email: 'a@example.com' } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnauthorizedException);
    const message = (thrown as UnauthorizedException).message;
    expect(message).toContain('req.user is set but has no usable id (its keys: sub, email)');
    expect(message).toContain('req.user.id');
    expect(message).toContain('adminGuard, agentGuard and customerGuard');
    expect(message).not.toContain('a@example.com');
    expect(warn).toHaveBeenCalledWith(message);
  });

  it('names the contract when the guard set no user at all', () => {
    expect(() => requireUserId({})).toThrow(/req\.user is not set.*req\.user\.id/);
  });
});

describe('setupProblems', () => {
  const guard = { canActivate: () => true };

  it('reports every missing route group guard', () => {
    const problems = setupProblems({});

    expect(problems.map((p) => p.check)).toEqual(['adminGuard', 'agentGuard', 'customerGuard']);
    expect(problems[0].message).toContain('every /escalated/admin/* route answers 403');
    expect(problems[0].message).toContain('req.user = { id }');
  });

  it('reports a guard that is not a CanActivate', () => {
    const problems = setupProblems({
      adminGuard: guard,
      agentGuard: { nope: true },
      customerGuard: guard,
      customerRouteGuards: [guard, 'can:escalated-agent'],
    });

    expect(problems.map((p) => p.check)).toEqual(['agentGuard', 'customerRouteGuards']);
  });

  it('reports nothing for a configured install', () => {
    class Guard {
      canActivate() {
        return true;
      }
    }
    expect(setupProblems({ adminGuard: Guard, agentGuard: guard, customerGuard: guard })).toEqual(
      [],
    );
  });

  it('logs the problems at startup', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    new EscalatedSetupCheck({ adminGuard: guard, agentGuard: guard }).onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('customerGuard is not configured');
    warn.mockRestore();
  });
});
