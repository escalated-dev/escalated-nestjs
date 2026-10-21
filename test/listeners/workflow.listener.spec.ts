import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowListener, WORKFLOW_TRIGGERS } from '../../src/listeners/workflow.listener';
import { CANONICAL_EVENTS } from '../../src/events/event-names';
import { WorkflowRunnerService } from '../../src/services/workflow-runner.service';
import {
  TicketAssignedEvent,
  TicketCreatedEvent,
  TicketReplyCreatedEvent,
  TicketStatusChangedEvent,
  TicketUnassignedEvent,
  TicketUpdatedEvent,
} from '../../src/events/escalated.events';

describe('WorkflowListener', () => {
  let listener: WorkflowListener;
  let runner: { runForEvent: jest.Mock };

  beforeEach(async () => {
    runner = { runForEvent: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowListener, { provide: WorkflowRunnerService, useValue: runner }],
    }).compile();
    listener = module.get(WorkflowListener);
  });

  it('maps TicketCreatedEvent to the ticket.created trigger', async () => {
    const ticket = { id: 1 };
    await listener.onTicketCreated(new TicketCreatedEvent(ticket, 0));
    expect(runner.runForEvent).toHaveBeenCalledWith('ticket.created', ticket);
  });

  it('maps TicketUpdatedEvent to the ticket.updated trigger', async () => {
    const ticket = { id: 1 };
    await listener.onTicketUpdated(new TicketUpdatedEvent(ticket, {}, 0));
    expect(runner.runForEvent).toHaveBeenCalledWith('ticket.updated', ticket);
  });

  it('maps TicketAssignedEvent to the ticket.assigned trigger', async () => {
    const ticket = { id: 1 };
    await listener.onTicketAssigned(new TicketAssignedEvent(ticket, null, 5, 0));
    expect(runner.runForEvent).toHaveBeenCalledWith('ticket.assigned', ticket);
  });

  it('maps TicketStatusChangedEvent to the ticket.status_changed trigger', async () => {
    const ticket = { id: 1 };
    await listener.onTicketStatusChanged(new TicketStatusChangedEvent(ticket, 1, 2, 0));
    expect(runner.runForEvent).toHaveBeenCalledWith('ticket.status_changed', ticket);
  });

  it('maps TicketReplyCreatedEvent to the reply.created trigger', async () => {
    const reply = { id: 1 };
    const ticket = { id: 1 };
    await listener.onReplyCreated(new TicketReplyCreatedEvent(reply, ticket, 0));
    expect(runner.runForEvent).toHaveBeenCalledWith('reply.created', ticket);
  });

  it('does not fire reply.created for an internal note', async () => {
    await listener.onReplyCreated(new TicketReplyCreatedEvent({ id: 1, isInternal: true }, {}, 0));
    expect(runner.runForEvent).not.toHaveBeenCalled();
  });

  it('maps TicketUnassignedEvent to the ticket.unassigned trigger', async () => {
    const ticket = { id: 1 };
    await listener.onTicketUnassigned(new TicketUnassignedEvent(ticket, 5, 0));
    expect(runner.runForEvent).toHaveBeenCalledWith('ticket.unassigned', ticket);
  });

  it('offers exactly the canonical trigger names', () => {
    for (const { value } of WORKFLOW_TRIGGERS) expect(CANONICAL_EVENTS).toContain(value);
    expect(WORKFLOW_TRIGGERS).toHaveLength(CANONICAL_EVENTS.length);
  });
});
