import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../config/escalated.config';
import type { UserId } from '../config/user-id-column';
import { AgentProfile } from '../entities/agent-profile.entity';

/** `@{Full Name}`, what the composer's mention picker inserts. */
const BRACED = /@\{([^}]+)\}/g;
/** `@username`, outside braces. */
const SIMPLE = /@([a-zA-Z0-9_.-]+)(?![^{]*\})/g;

export const MENTION_SUGGESTIONS_LIMIT = 10;

/** An agent as the mention picker lists it. */
export interface MentionableAgent {
  id: UserId;
  name: string;
  email: string | null;
}

/**
 * @mentions in replies and internal notes, as escalated-laravel's
 * MentionService: `@{Full Name}` and `@username` are matched against the
 * agents' names and emails, and the mentioned agents get a `mention`
 * notification (AgentNotificationsListener). Agents are the active agent
 * profiles, named by the host's `ui.resolveUsers` when given.
 */
@Injectable()
export class MentionService {
  constructor(
    @Optional()
    @InjectRepository(AgentProfile)
    private readonly profiles?: Repository<AgentProfile>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  /** The names mentioned in a body, braced and simple, trimmed and unique. */
  extractMentions(text: string): string[] {
    if (!text) return [];
    const names = [
      ...[...text.matchAll(BRACED)].map((match) => match[1]),
      ...[...text.matchAll(SIMPLE)].map((match) => match[1]),
    ]
      .map((name) => name.trim())
      .filter((name) => name !== '');
    return [...new Set(names)];
  }

  extractUsernameFromEmail(email: string): string {
    if (!email) return '';
    return email.split('@')[0] || email;
  }

  /** The ids of the agents a body mentions, by name or email (case-insensitive). */
  async mentionedAgentIds(text: string): Promise<UserId[]> {
    const names = new Set(this.extractMentions(text).map((name) => name.toLowerCase()));
    if (!names.size) return [];
    const ids = new Map<string, UserId>();
    for (const agent of await this.agents()) {
      const name = agent.name.toLowerCase();
      const email = agent.email?.toLowerCase() ?? null;
      if (names.has(name) || (email !== null && names.has(email)))
        ids.set(String(agent.id), agent.id);
    }
    return [...ids.values()];
  }

  /** The mention picker's suggestions: agents whose name or email contains the query. */
  async suggestions(query: string, limit = MENTION_SUGGESTIONS_LIMIT): Promise<MentionableAgent[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return (await this.agents())
      .filter(
        (agent) =>
          agent.name.toLowerCase().includes(needle) ||
          (agent.email?.toLowerCase().includes(needle) ?? false),
      )
      .slice(0, limit);
  }

  /** Every active agent, with the host's name and email when it resolves users. */
  private async agents(): Promise<MentionableAgent[]> {
    if (!this.profiles) return [];
    const profiles = await this.profiles.find({
      where: { isActive: true },
      select: { userId: true, displayName: true },
      order: { displayName: 'ASC', id: 'ASC' },
    });
    const users = new Map<string, { name?: string | null; email?: string | null }>();
    const resolveUsers = this.options?.ui?.resolveUsers;
    if (resolveUsers && profiles.length) {
      for (const user of (await resolveUsers(profiles.map((p) => p.userId))) ?? []) {
        if (user?.id != null) users.set(String(user.id), user);
      }
    }
    return profiles.map((profile) => {
      const user = users.get(String(profile.userId));
      return {
        id: profile.userId,
        name: user?.name || profile.displayName || `User #${profile.userId}`,
        email: user?.email ?? null,
      };
    });
  }
}
