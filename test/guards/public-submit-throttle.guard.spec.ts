import { ExecutionContext, HttpException } from '@nestjs/common';
import { PublicSubmitThrottleGuard } from '../../src/guards/public-submit-throttle.guard';

function mockContext(body: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body }),
    }),
  } as unknown as ExecutionContext;
}

describe('PublicSubmitThrottleGuard', () => {
  let guard: PublicSubmitThrottleGuard;

  beforeEach(() => {
    guard = new PublicSubmitThrottleGuard();
  });

  it('allows a request with no email (legacy requesterId path)', async () => {
    const ok = await guard.canActivate(mockContext({ requesterId: 5 }));
    expect(ok).toBe(true);
  });

  it('allows up to 10 requests per hour per email', async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await guard.canActivate(mockContext({ email: 'a@b.com' }));
      expect(ok).toBe(true);
    }
  });

  it('rejects the 11th request within an hour as 429', async () => {
    for (let i = 0; i < 10; i++) {
      await guard.canActivate(mockContext({ email: 'a@b.com' }));
    }

    await expect(guard.canActivate(mockContext({ email: 'a@b.com' }))).rejects.toBeInstanceOf(
      HttpException,
    );

    try {
      await guard.canActivate(mockContext({ email: 'a@b.com' }));
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(429);
    }
  });

  it('treats different emails as independent buckets', async () => {
    for (let i = 0; i < 10; i++) {
      await guard.canActivate(mockContext({ email: 'a@b.com' }));
    }
    const ok = await guard.canActivate(mockContext({ email: 'different@b.com' }));
    expect(ok).toBe(true);
  });

  it('treats uppercase variants of the same email as the same bucket', async () => {
    for (let i = 0; i < 10; i++) {
      await guard.canActivate(mockContext({ email: 'MixedCase@Example.Com' }));
    }
    await expect(
      guard.canActivate(mockContext({ email: 'mixedcase@example.com' })),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('drops timestamps older than one hour when counting', async () => {
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(now);
    for (let i = 0; i < 10; i++) {
      await guard.canActivate(mockContext({ email: 'a@b.com' }));
    }

    // Advance past the window (1h + 1s)
    nowSpy.mockReturnValue(now + 60 * 60 * 1000 + 1000);
    const ok = await guard.canActivate(mockContext({ email: 'a@b.com' }));
    expect(ok).toBe(true);

    nowSpy.mockRestore();
  });
});
