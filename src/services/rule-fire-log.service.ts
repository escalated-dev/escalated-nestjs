import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { RuleExecution } from '../entities/rule-execution.entity';

/**
 * Fire-once bookkeeping for the escalation sweep (escalated-laravel's
 * RuleFireLog).
 *
 * A rule fires once per ticket. When a ticket stops matching the rule its
 * record is removed, so the rule fires again if the ticket matches later. A
 * rule with `repeatAfterHours` also fires again once that many hours have
 * passed since it last fired, while the ticket still matches.
 */
@Injectable()
export class RuleFireLog {
  constructor(
    @InjectRepository(RuleExecution)
    private readonly executions: Repository<RuleExecution>,
  ) {}

  /**
   * Re-arms the rule for tickets that no longer match, and returns the
   * matching tickets the rule is due to act on.
   */
  async due<T extends { id: number }>(
    ruleType: string,
    ruleId: number,
    repeatAfterHours: number | null | undefined,
    matching: T[],
    now = new Date(),
  ): Promise<T[]> {
    const fired = await this.executions.find({ where: { ruleType, ruleId } });
    const matchingIds = new Set(matching.map((ticket) => Number(ticket.id)));

    const stale = fired
      .filter((row) => !matchingIds.has(Number(row.ticketId)))
      .map((row) => row.id);
    for (let i = 0; i < stale.length; i += 500) {
      await this.executions.delete({ id: In(stale.slice(i, i + 500)) });
    }

    const byTicket = new Map(fired.map((row) => [Number(row.ticketId), row]));
    const repeatAfter =
      repeatAfterHours != null && repeatAfterHours > 0
        ? now.getTime() - repeatAfterHours * 3_600_000
        : null;

    return matching.filter((ticket) => {
      const execution = byTicket.get(Number(ticket.id));
      if (!execution) return true;
      return repeatAfter !== null && new Date(execution.firedAt).getTime() <= repeatAfter;
    });
  }

  /** Records that the rule acted on the ticket now. */
  async record(ruleType: string, ruleId: number, ticketId: number, now = new Date()) {
    const keys = { ruleType, ruleId, ticketId };
    if (await this.executions.existsBy(keys)) {
      await this.executions.update(keys, { firedAt: now });
      return;
    }
    try {
      await this.executions.insert({ ...keys, firedAt: now });
    } catch (error) {
      // A concurrent sweep inserted the row first; refresh its time.
      if (!(error instanceof QueryFailedError)) throw error;
      await this.executions.update(keys, { firedAt: now });
    }
  }

  /** Forgets every record of a rule, e.g. when the rule is deleted. */
  async forget(ruleType: string, ruleId: number) {
    await this.executions.delete({ ruleType, ruleId });
  }
}
