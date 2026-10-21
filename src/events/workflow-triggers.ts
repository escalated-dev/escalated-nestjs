/**
 * The workflow trigger each internal event fires, under the shared vocabulary
 * (ADR 2026-10-21). Every one of these is offered by the workflow builder, and
 * the builder offers nothing else.
 */
export const WORKFLOW_TRIGGERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'ticket.created', label: 'Ticket created' },
  { value: 'ticket.updated', label: 'Ticket updated' },
  { value: 'ticket.status_changed', label: 'Status changed' },
  { value: 'ticket.resolved', label: 'Ticket resolved' },
  { value: 'ticket.closed', label: 'Ticket closed' },
  { value: 'ticket.reopened', label: 'Ticket reopened' },
  { value: 'ticket.assigned', label: 'Ticket assigned' },
  { value: 'ticket.unassigned', label: 'Ticket unassigned' },
  { value: 'ticket.escalated', label: 'Ticket escalated' },
  { value: 'ticket.priority_changed', label: 'Priority changed' },
  { value: 'ticket.department_changed', label: 'Department changed' },
  { value: 'ticket.tag_added', label: 'Tag added' },
  { value: 'ticket.tag_removed', label: 'Tag removed' },
  { value: 'reply.created', label: 'Reply created' },
  { value: 'note.created', label: 'Internal note added' },
  { value: 'sla.warning', label: 'SLA warning' },
  { value: 'sla.breached', label: 'SLA breached' },
  { value: 'chat.started', label: 'Chat started' },
  { value: 'chat.assigned', label: 'Chat assigned' },
  { value: 'chat.transferred', label: 'Chat transferred' },
  { value: 'chat.message', label: 'Chat message' },
  { value: 'chat.ended', label: 'Chat ended' },
];
