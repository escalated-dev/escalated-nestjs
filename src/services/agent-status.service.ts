import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserId } from '../config/user-id-column';
import { AgentProfile } from '../entities/agent-profile.entity';

export const AGENT_STATUSES = ['online', 'away', 'offline'] as const;
export type AgentStatusValue = (typeof AGENT_STATUSES)[number];

export function isAgentStatus(value: unknown): value is AgentStatusValue {
  return typeof value === 'string' && (AGENT_STATUSES as readonly string[]).includes(value);
}

/**
 * The agent's own Online / Away / Offline status (ADR
 * 2026-11-05-agent-panel-data, section 3), on the agent profile. Live-chat
 * routing reads `isAvailable`, which is kept equal to `status === 'online'`, so
 * an Away or Offline agent gets no new chats. An agent with no profile is
 * `offline`.
 */
@Injectable()
export class AgentStatusService {
  constructor(
    @InjectRepository(AgentProfile) private readonly profiles: Repository<AgentProfile>,
  ) {}

  async get(agent: UserId): Promise<AgentStatusValue> {
    const profile = await this.profiles.findOne({
      where: { userId: agent },
      select: { id: true, chatStatus: true },
    });
    return isAgentStatus(profile?.chatStatus)
      ? (profile!.chatStatus as AgentStatusValue)
      : 'offline';
  }

  async set(agent: UserId, status: AgentStatusValue): Promise<void> {
    const values = { chatStatus: status, isAvailable: status === 'online' };
    const updated = await this.profiles.update({ userId: agent }, values);
    if (updated.affected) return;
    try {
      await this.profiles.insert({ userId: agent, ...values });
    } catch {
      await this.profiles.update({ userId: agent }, values);
    }
  }
}
