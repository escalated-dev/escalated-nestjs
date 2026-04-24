import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type InboundEmailOutcome =
  | 'reply_added'
  | 'ticket_created'
  | 'ignored'
  | 'error';

/**
 * Audit log for every inbound email webhook call, successful or not.
 * Retains the raw provider payload for diagnostics + the parse + route
 * outcome so operators can debug "where did this email go?" questions.
 */
@Entity('escalated_inbound_emails')
@Index(['parsedFrom'])
@Index(['matchedTicketId'])
export class InboundEmail {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  provider: string;

  @Column({ type: 'simple-json', default: '{}' })
  rawPayload: Record<string, unknown>;

  @Column({ length: 320, nullable: true, type: 'varchar' })
  parsedFrom: string | null;

  @Column({ length: 500, nullable: true, type: 'varchar' })
  parsedSubject: string | null;

  @Column({ length: 255, nullable: true, type: 'varchar' })
  parsedMessageId: string | null;

  @Column({ length: 255, nullable: true, type: 'varchar' })
  parsedInReplyTo: string | null;

  @Column({ type: 'int', nullable: true })
  matchedTicketId: number | null;

  @Column({ type: 'int', nullable: true })
  createdTicketId: number | null;

  @Column({ type: 'int', nullable: true })
  createdReplyId: number | null;

  @Column({ length: 20, default: 'ignored' })
  outcome: InboundEmailOutcome;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
