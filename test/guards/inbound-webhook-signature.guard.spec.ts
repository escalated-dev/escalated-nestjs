import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InboundWebhookSignatureGuard } from '../../src/guards/inbound-webhook-signature.guard';

function ctx(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('InboundWebhookSignatureGuard', () => {
  it('passes when the shared secret header matches', async () => {
    const g = new InboundWebhookSignatureGuard({
      inbound: {
        replyDomain: 'x',
        replySecret: 'y',
        webhookSecret: 'hunter2',
      },
    } as any);
    await expect(
      g.canActivate(ctx({ 'x-escalated-inbound-secret': 'hunter2' })),
    ).resolves.toBe(true);
  });

  it('rejects when the header is missing', async () => {
    const g = new InboundWebhookSignatureGuard({
      inbound: { replyDomain: 'x', replySecret: 'y', webhookSecret: 'hunter2' },
    } as any);
    await expect(g.canActivate(ctx({}))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the header does not match', async () => {
    const g = new InboundWebhookSignatureGuard({
      inbound: { replyDomain: 'x', replySecret: 'y', webhookSecret: 'hunter2' },
    } as any);
    await expect(
      g.canActivate(ctx({ 'x-escalated-inbound-secret': 'wrong' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when no inbound config is present at all', async () => {
    const g = new InboundWebhookSignatureGuard({} as any);
    await expect(
      g.canActivate(ctx({ 'x-escalated-inbound-secret': 'anything' })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
