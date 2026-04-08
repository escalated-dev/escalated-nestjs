import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatRoutingRule } from '../entities/chat-routing-rule.entity';

export interface RouteResult {
  departmentId: number | null;
  agentId: number | null;
}

@Injectable()
export class ChatRoutingService {
  constructor(
    @InjectRepository(ChatRoutingRule)
    private readonly ruleRepo: Repository<ChatRoutingRule>,
  ) {}

  /**
   * Resolve the best routing target for a new chat session.
   */
  async resolve(requestedDepartmentId?: number): Promise<RouteResult> {
    const rules = await this.ruleRepo.find({
      where: { isActive: true },
      order: { priority: 'ASC' },
    });

    for (const rule of rules) {
      if (rule.departmentId && rule.departmentId === requestedDepartmentId) {
        return {
          departmentId: rule.departmentId,
          agentId: rule.agentId,
        };
      }

      if (!requestedDepartmentId) {
        return {
          departmentId: rule.departmentId,
          agentId: rule.agentId,
        };
      }
    }

    return { departmentId: requestedDepartmentId || null, agentId: null };
  }

  async createRule(data: Partial<ChatRoutingRule>): Promise<ChatRoutingRule> {
    const rule = this.ruleRepo.create(data);
    return this.ruleRepo.save(rule);
  }

  async getAllRules(): Promise<ChatRoutingRule[]> {
    return this.ruleRepo.find({
      where: { isActive: true },
      order: { priority: 'ASC' },
    });
  }

  async deleteRule(id: number): Promise<void> {
    await this.ruleRepo.delete(id);
  }
}
