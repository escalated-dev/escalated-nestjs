import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NewsletterEnabledGuard } from '../../src/guards/newsletter-enabled.guard';
import { AdminNewsletterController } from '../../src/controllers/newsletter/admin-newsletter.controller';
import {
  NewsletterEspWebhookController,
  NewsletterPublicController,
} from '../../src/controllers/newsletter/newsletter-public.controller';

function responseMock() {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('Newsletter HTTP smoke tests', () => {
  it('enabled guard returns 404 when newsletters are disabled', () => {
    const guard = new NewsletterEnabledGuard({ enableNewsletters: false });
    expect(() => guard.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('admin index returns the Laravel page component name', async () => {
    const controller = new AdminNewsletterController(
      { enableNewsletters: true, newsletters: {} },
      { require: jest.fn() } as any,
      {} as any,
      {} as any,
      { find: jest.fn(async () => [{ id: 1 }]) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(controller.index({ user: { id: 1 } }, 'drafts')).resolves.toEqual({
      component: 'Escalated/Admin/Newsletters/Index',
      props: { newsletters: [{ id: 1 }], tab: 'drafts' },
    });
  });

  it('public open pixel records the stripped token and returns bytes', async () => {
    const tracker = { recordOpen: jest.fn(), recordClick: jest.fn() };
    const controller = new NewsletterPublicController(
      tracker as any,
      { render: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    const res = responseMock();
    await controller.open('abc.gif', res);
    expect(tracker.recordOpen).toHaveBeenCalledWith('abc');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
  });

  it('public click rejects non-http destinations', async () => {
    const controller = new NewsletterPublicController(
      { recordOpen: jest.fn(), recordClick: jest.fn() } as any,
      { render: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    const encoded = Buffer.from('javascript:alert(1)', 'utf8').toString('base64');
    await expect(controller.click('abc', encoded, responseMock())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('webhook handlers extract token and map sendgrid spam reports', async () => {
    const tracker = {
      recordOpen: jest.fn(),
      recordClick: jest.fn(),
      recordBounce: jest.fn(),
      recordComplaint: jest.fn(),
    };
    const controller = new NewsletterEspWebhookController(tracker as any);
    await expect(
      controller.sendgrid([{ event: 'spamreport', 'smtp-id': '<n-12-abc123@example.com>' }]),
    ).resolves.toEqual({ ok: true });
    expect(tracker.recordComplaint).toHaveBeenCalledWith('abc123');
  });
});
