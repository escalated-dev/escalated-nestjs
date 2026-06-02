import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { Contact } from '../../entities/contact.entity';
import { NewsletterDelivery } from '../../entities/newsletter';
import { NewsletterEnabledGuard } from '../../guards/newsletter-enabled.guard';
import { NewsletterRendererService } from '../../services/newsletter/newsletter-renderer.service';
import { NewsletterTrackerService } from '../../services/newsletter/newsletter-tracker.service';
import { decodeTrackedUrl } from './newsletter-http.utils';

const PIXEL_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63fcffff3f030005fe02fedccc59e70000000049454e44ae426082',
  'hex',
);

@UseGuards(NewsletterEnabledGuard)
@Controller('escalated/n')
export class NewsletterPublicController {
  private static readonly unsubscribeAttempts = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private readonly tracker: NewsletterTrackerService,
    private readonly renderer: NewsletterRendererService,
    @InjectRepository(NewsletterDelivery)
    private readonly deliveries: Repository<NewsletterDelivery>,
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
  ) {}

  @Get('o/:token')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async open(@Param('token') token: string, @Res() res: Response) {
    await this.tracker.recordOpen(token.replace(/\.(gif|png|jpg)$/i, ''));
    res.status(200).send(PIXEL_BYTES);
  }

  @Get('c/:token')
  async click(@Param('token') token: string, @Query('u') encoded = '', @Res() res: Response) {
    const destination = decodeTrackedUrl(encoded);
    await this.tracker.recordClick(token, destination);
    res.redirect(302, destination);
  }

  @Get('u/:token')
  async unsubscribeShow(@Param('token') token: string, @Res() res: Response) {
    const delivery = await this.findDelivery(token);
    res.status(200).type('html').send(this.unsubscribeHtml(token, delivery?.email_at_send ?? null, false));
  }

  @Post('u/:token')
  async unsubscribeStore(@Req() req: any, @Param('token') token: string, @Res() res: Response) {
    if (this.tooManyUnsubscribes(req.ip ?? req.connection?.remoteAddress ?? 'unknown')) {
      res.status(429).send('Too Many Requests');
      return;
    }
    const delivery = await this.findDelivery(token);
    if (delivery?.contact_id) {
      await this.contacts.update(delivery.contact_id, { marketing_opt_out_at: new Date() });
    }
    res.status(200).type('html').send(this.unsubscribeHtml(token, delivery?.email_at_send ?? null, true));
  }

  @Get('v/:token')
  async view(@Param('token') token: string, @Res() res: Response) {
    const delivery = await this.deliveries.findOne({
      where: { tracking_token: token },
      relations: { newsletter: { template: true }, contact: true },
    });
    if (!delivery) {
      res
        .status(200)
        .type('html')
        .send(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Email unavailable</title></head><body><p>This email is no longer available.</p></body></html>',
        );
      return;
    }
    res.status(200).type('html').send(this.renderer.render(delivery));
  }

  private async findDelivery(token: string): Promise<NewsletterDelivery | null> {
    return this.deliveries.findOne({ where: { tracking_token: token } });
  }

  private tooManyUnsubscribes(ip: string): boolean {
    const now = Date.now();
    const entry = NewsletterPublicController.unsubscribeAttempts.get(ip);
    if (!entry || entry.expiresAt <= now) {
      NewsletterPublicController.unsubscribeAttempts.set(ip, { count: 1, expiresAt: now + 60_000 });
      return false;
    }
    entry.count += 1;
    return entry.count > 60;
  }

  private unsubscribeHtml(token: string, email: string | null, confirmed: boolean): string {
    const escapedToken = this.escape(token);
    const escapedEmail = this.escape(email ?? '');
    const message = confirmed
      ? 'You have been unsubscribed.'
      : 'Confirm that you want to unsubscribe from marketing emails.';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unsubscribe</title></head><body><main><h1>Unsubscribe</h1><p>${message}</p><p>${escapedEmail}</p><form method="post" action="/escalated/n/u/${escapedToken}"><button type="submit">Unsubscribe</button></form></main></body></html>`;
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

@UseGuards(NewsletterEnabledGuard)
@Controller('escalated/webhooks/newsletter')
export class NewsletterEspWebhookController {
  constructor(private readonly tracker: NewsletterTrackerService) {}

  @Post('postmark')
  async postmark(@Body() body: any) {
    const token = this.tokenFromMessageId(String(body?.MessageID ?? ''));
    switch (String(body?.RecordType ?? '')) {
      case 'Open':
        await this.tracker.recordOpen(token);
        break;
      case 'Click':
        await this.tracker.recordClick(token, String(body?.OriginalLink ?? ''));
        break;
      case 'Bounce':
        await this.tracker.recordBounce(
          token,
          ['HardBounce', 'BadEmailAddress', 'BlockedRecipient'].includes(String(body?.Type ?? ''))
            ? 'hard'
            : 'soft',
          String(body?.Description ?? ''),
        );
        break;
      case 'SpamComplaint':
        await this.tracker.recordComplaint(token);
        break;
    }
    return { ok: true };
  }

  @Post('mailgun')
  async mailgun(@Body() body: any) {
    const eventData = body?.['event-data'] ?? {};
    const token = this.tokenFromMessageId(String(eventData?.message?.headers?.['message-id'] ?? ''));
    switch (String(eventData?.event ?? '')) {
      case 'opened':
        await this.tracker.recordOpen(token);
        break;
      case 'clicked':
        await this.tracker.recordClick(token, String(eventData?.url ?? ''));
        break;
      case 'failed':
        await this.tracker.recordBounce(
          token,
          eventData?.severity === 'permanent' ? 'hard' : 'soft',
          String(eventData?.['delivery-status']?.description ?? ''),
        );
        break;
      case 'complained':
        await this.tracker.recordComplaint(token);
        break;
    }
    return { ok: true };
  }

  @Post('ses')
  async ses(@Body() body: any) {
    const message = typeof body?.Message === 'string' ? JSON.parse(body.Message) : body?.Message ?? body;
    const token = this.tokenFromMessageId(String(message?.mail?.messageId ?? ''));
    switch (String(message?.eventType ?? '')) {
      case 'Open':
        await this.tracker.recordOpen(token);
        break;
      case 'Click':
        await this.tracker.recordClick(token, String(message?.click?.link ?? ''));
        break;
      case 'Bounce':
        await this.tracker.recordBounce(
          token,
          message?.bounce?.bounceType === 'Permanent' ? 'hard' : 'soft',
          message?.bounce?.bounceSubType ?? null,
        );
        break;
      case 'Complaint':
        await this.tracker.recordComplaint(token);
        break;
    }
    return { ok: true };
  }

  @Post('sendgrid')
  async sendgrid(@Body() body: any) {
    for (const event of Array.isArray(body) ? body : []) {
      const token = this.tokenFromMessageId(String(event?.['smtp-id'] ?? event?.sg_message_id ?? ''));
      switch (event?.event) {
        case 'open':
          await this.tracker.recordOpen(token);
          break;
        case 'click':
          await this.tracker.recordClick(token, String(event?.url ?? ''));
          break;
        case 'bounce':
          await this.tracker.recordBounce(
            token,
            event?.type === 'blocked' ? 'hard' : 'soft',
            event?.reason ?? null,
          );
          break;
        case 'dropped':
          await this.tracker.recordBounce(token, 'hard', event?.reason ?? null);
          break;
        case 'spamreport':
          await this.tracker.recordComplaint(token);
          break;
      }
    }
    return { ok: true };
  }

  private tokenFromMessageId(messageId: string): string {
    const matched = messageId.match(/n-\d+-([A-Za-z0-9]+)@/);
    if (matched) return matched[1];
    const localMatched = (messageId.split('@')[0] ?? '').match(/^n-\d+-([A-Za-z0-9]+)$/);
    return localMatched?.[1] ?? '';
  }
}
