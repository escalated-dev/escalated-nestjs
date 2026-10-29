import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CANONICAL_EVENTS } from '../events/event-names';
import { webhookEventName } from '../services/webhook.service';
import { PluginDomainService } from './plugin-domain.service';
import { pluginEventPayload } from './plugin-payloads';
import { PluginRegistry } from './plugin-registry.service';

const CANONICAL = new Set<string>(CANONICAL_EVENTS);

/**
 * Delivers the canonical events (ADR 2026-10-21) to active plugins' actions,
 * under the names webhooks use and nothing else: merged and split tickets,
 * which are not in the shared vocabulary, are not delivered. Runs after the
 * emitting code has written its change, and never fails it.
 */
@Injectable()
export class PluginEventsListener {
  private readonly logger = new Logger('EscalatedPlugins');

  constructor(
    private readonly registry: PluginRegistry,
    private readonly domain: PluginDomainService,
  ) {}

  @OnEvent('escalated.**')
  async handle(event: unknown): Promise<void> {
    if (!this.registry.all().length) return;
    const name = webhookEventName(event);
    if (!name || !CANONICAL.has(name)) return;
    try {
      const payload = pluginEventPayload(name, event, await this.domain.statusSlugs());
      await this.registry.dispatchAction(name, payload);
    } catch (error) {
      this.logger.error(`Delivering ${name} to plugins failed: ${(error as Error)?.message}`);
    }
  }
}
