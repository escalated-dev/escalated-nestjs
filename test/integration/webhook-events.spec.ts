import { Injectable } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { bootEscalatedModule } from './boot-escalated-module';
import { Webhook } from '../../src/entities/webhook.entity';
import { WebhookDelivery } from '../../src/entities/webhook-delivery.entity';
import { WorkflowRunnerService } from '../../src/services/workflow-runner.service';
import {
  ESCALATED_EVENTS,
  SlaBreachedEvent,
  TicketCreatedEvent,
  TicketUpdatedEvent,
} from '../../src/events/escalated.events';

jest.setTimeout(60000);

/**
 * Emits real events through the EventEmitter2 instance the real
 * EscalatedModule registers, so listener wiring (wildcards included) is
 * exercised exactly as in a host app.
 */

const ALL_EVENTS_URL = 'https://1.1.1.1/all-events';
const UPDATES_ONLY_URL = 'https://1.0.0.1/updates-only';

@Injectable()
class HostTicketListener {
  readonly created = jest.fn();
  readonly updated = jest.fn();
  readonly colonNamed = jest.fn();

  @OnEvent(ESCALATED_EVENTS.TICKET_CREATED)
  onCreated(event: unknown) {
    this.created(event);
  }

  @OnEvent(ESCALATED_EVENTS.TICKET_UPDATED)
  onUpdated(event: unknown) {
    this.updated(event);
  }

  @OnEvent('host:ticket-created')
  onColonNamed(event: unknown) {
    this.colonNamed(event);
  }
}

describe('Event wiring in the booted EscalatedModule', () => {
  let moduleRef: TestingModule;
  let emitter: EventEmitter2;
  let fetchMock: jest.SpyInstance;
  let runner: { runForEvent: jest.Mock };
  let deliveries: { save: jest.Mock };

  beforeEach(async () => {
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('ok', { status: 200 }));
    runner = { runForEvent: jest.fn(async () => undefined) };
    deliveries = { save: jest.fn(async (d) => ({ id: 1, ...d })) };

    moduleRef = await bootEscalatedModule({
      host: { providers: [HostTicketListener] },
      configure: (builder) =>
        builder
          .overrideProvider(getRepositoryToken(Webhook))
          .useValue({
            find: jest.fn(async () => [
              {
                id: 1,
                url: ALL_EVENTS_URL,
                secret: 's1',
                events: ['*'],
                isActive: true,
              },
              {
                id: 2,
                url: UPDATES_ONLY_URL,
                secret: 's2',
                events: ['ticket.updated'],
                isActive: true,
              },
            ]),
            update: jest.fn(async () => ({ affected: 1 })),
          })
          .overrideProvider(getRepositoryToken(WebhookDelivery))
          .useValue(deliveries)
          .overrideProvider(WorkflowRunnerService)
          .useValue(runner),
    });
    await moduleRef.init();
    emitter = moduleRef.get(EventEmitter2);
  });

  afterEach(async () => {
    await moduleRef?.close();
    fetchMock.mockRestore();
  });

  const deliveredUrls = () => fetchMock.mock.calls.map(([url]) => String(url));

  describe('outbound webhooks', () => {
    it('delivers ticket.created to a webhook subscribed to every event', async () => {
      await emitter.emitAsync(
        ESCALATED_EVENTS.TICKET_CREATED,
        new TicketCreatedEvent({ id: 42, subject: 'Printer on fire' }, 7),
      );

      expect(deliveredUrls()).toEqual([ALL_EVENTS_URL]);
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.headers['X-Escalated-Event']).toBe('ticket.created');
      expect(JSON.parse(init.body)).toMatchObject({
        event: 'ticket.created',
        data: { ticket: { id: 42 }, userId: 7 },
      });
    });

    it('delivers ticket.updated to every webhook subscribed to it', async () => {
      await emitter.emitAsync(
        ESCALATED_EVENTS.TICKET_UPDATED,
        new TicketUpdatedEvent({ id: 42 }, { priority: 'high' }, 7),
      );

      expect(deliveredUrls().sort()).toEqual([UPDATES_ONLY_URL, ALL_EVENTS_URL].sort());
    });

    it('delivers sla.breached', async () => {
      await emitter.emitAsync(
        ESCALATED_EVENTS.SLA_BREACHED,
        new SlaBreachedEvent({ id: 42 }, 'first_response'),
      );

      expect(deliveredUrls()).toEqual([ALL_EVENTS_URL]);
      expect(fetchMock.mock.calls[0][1].headers['X-Escalated-Event']).toBe('sla.breached');
    });

    it('ignores escalated events that have no webhook name', async () => {
      await emitter.emitAsync(ESCALATED_EVENTS.CHAT_STARTED, { session: { id: 1 } });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('exact-name listeners', () => {
    it('run once for their own event and not for others', async () => {
      const host = moduleRef.get(HostTicketListener);
      const ticket = { id: 42 };

      await emitter.emitAsync(ESCALATED_EVENTS.TICKET_CREATED, new TicketCreatedEvent(ticket, 7));

      expect(host.created).toHaveBeenCalledTimes(1);
      expect(host.updated).not.toHaveBeenCalled();
      expect(runner.runForEvent).toHaveBeenCalledTimes(1);
      expect(runner.runForEvent).toHaveBeenCalledWith('ticket.created', ticket);
    });

    it('are not reached by unrelated escalated events', async () => {
      const host = moduleRef.get(HostTicketListener);

      await emitter.emitAsync(ESCALATED_EVENTS.CHAT_STARTED, { session: { id: 1 } });
      await emitter.emitAsync(ESCALATED_EVENTS.SIGNUP_INVITE, { ticketId: 1 });

      expect(host.created).not.toHaveBeenCalled();
      expect(host.updated).not.toHaveBeenCalled();
      expect(runner.runForEvent).not.toHaveBeenCalled();
    });

    it('still receive event names without the dot delimiter', async () => {
      const host = moduleRef.get(HostTicketListener);

      await emitter.emitAsync('host:ticket-created', { id: 1 });

      expect(host.colonNamed).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
