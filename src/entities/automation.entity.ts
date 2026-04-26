import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Automation — admin-configured, time-based rules engine.
 *
 * Distinct from Workflow (event-driven) and Macro (agent-applied manual).
 * See escalated-developer-context/domain-model/workflows-automations-macros.md.
 *
 * A cron tick runs every active automation against open tickets matching its
 * conditions, executing its actions on each match.
 */
@Entity('escalated_automations')
export class Automation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /**
   * Conditions evaluated against the ticket query.
   *
   * Shape: [{ field, operator, value }, ...]
   *
   * Supported fields:
   *   - hours_since_created    (with operator > / < / >= / <=)
   *   - hours_since_updated
   *   - hours_since_assigned
   *   - status                 (with operator =)
   *   - priority
   *   - assigned               (value: 'assigned' | 'unassigned')
   *   - ticket_type
   *   - subject_contains       (LIKE %value%)
   */
  @Column({ type: 'simple-json' })
  conditions: Record<string, any>[];

  /**
   * Actions executed on each matching ticket.
   *
   * Shape: [{ type, value }, ...]
   *
   * Supported types:
   *   - change_status       (value: status string)
   *   - change_priority     (value: priority string)
   *   - assign              (value: agent userId)
   *   - add_tag             (value: tag name)
   *   - add_note            (value: note body — written as internal note)
   *   - set_ticket_type     (value: type string)
   */
  @Column({ type: 'simple-json' })
  actions: Record<string, any>[];

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'datetime', nullable: true })
  lastRunAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
