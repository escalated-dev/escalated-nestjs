import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import {
  GUEST_THROTTLE_SCOPE,
  GuestThrottleGuard,
  type GuestThrottleScope,
} from '../../src/guards/guest-throttle.guard';
import type { EscalatedModuleOptions } from '../../src/config/escalated.config';

function mockContext(scope: GuestThrottleScope | undefined, ip: string) {
  const headers: Record<string, unknown> = {};
  const handler = () => undefined;
  if (scope) Reflect.defineMetadata(GUEST_THROTTLE_SCOPE, scope, handler);
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: { remoteAddress: ip } }),
      getResponse: () => ({
        header: (name: string, value: unknown) => {
          headers[name] = value;
        },
      }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

async function statusOf(promise: Promise<boolean>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (err) {
    return (err as HttpException).getStatus();
  }
}

describe('GuestThrottleGuard', () => {
  let storage: ThrottlerStorageService;

  function guard(options: Partial<EscalatedModuleOptions> = {}) {
    return new GuestThrottleGuard(storage, new Reflector(), options as EscalatedModuleOptions);
  }

  async function hit(g: GuestThrottleGuard, scope: GuestThrottleScope, ip: string, times: number) {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) {
      statuses.push(await statusOf(g.canActivate(mockContext(scope, ip).context)));
    }
    return statuses;
  }

  beforeEach(() => {
    storage = new ThrottlerStorageService();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
  });

  it('allows 5 guest ticket submissions per minute per IP and rejects the 6th with 429', async () => {
    const statuses = await hit(guard(), 'ticket', '203.0.113.1', 6);

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('allows 10 guest replies per minute per IP and rejects the 11th with 429', async () => {
    const statuses = await hit(guard(), 'reply', '203.0.113.1', 11);

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('keys each client IP separately', async () => {
    const g = guard();
    await hit(g, 'ticket', '203.0.113.1', 5);

    expect(await hit(g, 'ticket', '203.0.113.2', 1)).toEqual([200]);
  });

  it('counts ticket submissions and replies in separate buckets', async () => {
    const g = guard();
    await hit(g, 'ticket', '203.0.113.1', 5);

    expect(await hit(g, 'reply', '203.0.113.1', 1)).toEqual([200]);
  });

  it('honours configured limits', async () => {
    const g = guard({ guestRateLimit: { ticketsPerMinute: 2, repliesPerMinute: 1 } });

    expect(await hit(g, 'ticket', '203.0.113.1', 3)).toEqual([200, 200, 429]);
    expect(await hit(g, 'reply', '203.0.113.1', 2)).toEqual([200, 429]);
  });

  it('keeps the default for a limit the host left unset', async () => {
    const g = guard({ guestRateLimit: { repliesPerMinute: 1 } });

    expect(await hit(g, 'ticket', '203.0.113.1', 6)).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('can be switched off by a host that throttles upstream', async () => {
    const g = guard({ guestRateLimit: { enabled: false } });

    expect((await hit(g, 'ticket', '203.0.113.1', 20)).every((s) => s === 200)).toBe(true);
  });

  it('sets Retry-After when it rejects', async () => {
    const g = guard({ guestRateLimit: { ticketsPerMinute: 1 } });
    await hit(g, 'ticket', '203.0.113.1', 1);

    const { context, headers } = mockContext('ticket', '203.0.113.1');
    await expect(g.canActivate(context)).rejects.toBeInstanceOf(HttpException);

    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
    expect(Number(headers['Retry-After'])).toBeLessThanOrEqual(60);
  });

  it('passes a route that declares no guest throttle scope', async () => {
    const g = guard({ guestRateLimit: { ticketsPerMinute: 1 } });

    for (let i = 0; i < 5; i++) {
      await expect(g.canActivate(mockContext(undefined, '203.0.113.1').context)).resolves.toBe(
        true,
      );
    }
  });
});
