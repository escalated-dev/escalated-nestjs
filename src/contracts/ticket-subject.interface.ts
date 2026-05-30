/**
 * Presentation contract for a host-app entity attached as a ticket subject
 * (Project, Customer, asset, …). Host models implement these methods so the
 * agent UI can render title, subtitle, link, color, and icon.
 */
export interface TicketSubject {
  ticketSubjectTitle(): string;
  ticketSubjectSubtitle(): string | null;
  ticketSubjectUrl(): string | null;
  ticketSubjectColor(): string | null;
  ticketSubjectIcon(): string | null;
}
