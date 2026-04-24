import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboundRouterService } from '../services/email/inbound-router.service';
import { PostmarkInboundParser } from '../services/email/postmark-parser.service';
import { InboundEmail } from '../entities/inbound-email.entity';
import { InboundWebhookSignatureGuard } from '../guards/inbound-webhook-signature.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';

@Controller('escalated/webhook/email')
@UseGuards(InboundWebhookSignatureGuard)
export class InboundEmailController {
  constructor(
    private readonly router: InboundRouterService,
    private readonly postmarkParser: PostmarkInboundParser,
    @InjectRepository(InboundEmail)
    private readonly inboundRepo: Repository<InboundEmail>,
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
  ) {}

  @Post('inbound')
  async receive(@Body() body: unknown): Promise<{ ok: boolean; outcome: string }> {
    // Today: Postmark only. Mailgun / SendGrid adapters drop in by
    // switching on options.inbound.provider.
    const parsed = this.postmarkParser.parse(body);
    const result = await this.router.route(parsed);

    await this.inboundRepo.save({
      provider: this.options.inbound?.provider ?? 'postmark',
      rawPayload: (body ?? {}) as Record<string, unknown>,
      parsedFrom: parsed.from || null,
      parsedSubject: parsed.subject || null,
      parsedMessageId: parsed.messageId,
      parsedInReplyTo: parsed.inReplyTo,
      matchedTicketId: result.matchedTicketId ?? null,
      createdTicketId: result.createdTicketId ?? null,
      createdReplyId: result.createdReplyId ?? null,
      outcome: result.outcome,
      error: result.error ?? null,
    });

    const ok = result.outcome !== 'error';
    return { ok, outcome: result.outcome };
  }
}
