import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * When a rule last acted on a ticket (escalated-laravel's `rule_executions`).
 * The escalation sweep skips a ticket that has a row, so a rule fires once per
 * ticket; the row goes once the ticket stops matching, re-arming the rule.
 */
@Entity('escalated_rule_executions')
@Index('IDX_escalated_rule_exec_unique', ['ruleType', 'ruleId', 'ticketId'], { unique: true })
@Index('IDX_escalated_rule_exec_ticket', ['ticketId'])
export class RuleExecution {
  static readonly ESCALATION_RULE = 'escalation_rule';

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 32 })
  ruleType: string;

  @Column({ type: 'int' })
  ruleId: number;

  @Column({ type: 'int' })
  ticketId: number;

  @Column({ type: Date })
  firedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
