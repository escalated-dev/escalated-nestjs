import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AgentProfile } from '../entities/agent-profile.entity';
import { AgentCapacity } from '../entities/agent-capacity.entity';
import { Skill } from '../entities/skill.entity';
import { Ticket } from '../entities/ticket.entity';

@Injectable()
export class AgentService {
  constructor(
    @InjectRepository(AgentProfile)
    private readonly profileRepo: Repository<AgentProfile>,
    @InjectRepository(AgentCapacity)
    private readonly capacityRepo: Repository<AgentCapacity>,
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
  ) {}

  async findAll(): Promise<AgentProfile[]> {
    return this.profileRepo.find({
      relations: ['skills', 'departments'],
      order: { displayName: 'ASC' },
    });
  }

  async findById(id: number): Promise<AgentProfile> {
    const profile = await this.profileRepo.findOne({
      where: { id },
      relations: ['skills', 'departments'],
    });
    if (!profile) throw new NotFoundException(`Agent profile #${id} not found`);
    return profile;
  }

  async findByUserId(userId: number): Promise<AgentProfile> {
    const profile = await this.profileRepo.findOne({
      where: { userId },
      relations: ['skills', 'departments'],
    });
    if (!profile) throw new NotFoundException(`Agent profile for user #${userId} not found`);
    return profile;
  }

  async create(data: Partial<AgentProfile>): Promise<AgentProfile> {
    const profile = this.profileRepo.create(data);
    const saved = await this.profileRepo.save(profile);

    // Create capacity record
    await this.capacityRepo.save({
      agentProfileId: saved.id,
      maxTickets: 20,
      currentTickets: 0,
    });

    return this.findById(saved.id);
  }

  async update(id: number, data: Partial<AgentProfile>): Promise<AgentProfile> {
    await this.findById(id);
    await this.profileRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const profile = await this.findById(id);
    await this.profileRepo.remove(profile);
  }

  async setSkills(agentId: number, skillIds: number[]): Promise<AgentProfile> {
    const profile = await this.findById(agentId);
    const skills = await this.skillRepo.findBy({ id: In(skillIds) });
    profile.skills = skills;
    await this.profileRepo.save(profile);
    return this.findById(agentId);
  }

  // Capacity management
  async getCapacity(agentProfileId: number): Promise<AgentCapacity> {
    let capacity = await this.capacityRepo.findOne({ where: { agentProfileId } });
    if (!capacity) {
      capacity = await this.capacityRepo.save({
        agentProfileId,
        maxTickets: 20,
        currentTickets: 0,
      });
    }
    return capacity;
  }

  async updateCapacity(agentProfileId: number, data: Partial<AgentCapacity>): Promise<AgentCapacity> {
    const capacity = await this.getCapacity(agentProfileId);
    await this.capacityRepo.update(capacity.id, data);
    return this.getCapacity(agentProfileId);
  }

  async recalculateCapacity(agentProfileId: number): Promise<AgentCapacity> {
    const profile = await this.findById(agentProfileId);
    const openTicketCount = await this.ticketRepo.count({
      where: { assigneeId: profile.userId, isMerged: false },
    });
    const urgentCount = await this.ticketRepo.count({
      where: { assigneeId: profile.userId, priority: 'urgent', isMerged: false },
    });

    await this.capacityRepo.update(
      { agentProfileId },
      { currentTickets: openTicketCount, currentUrgent: urgentCount },
    );

    return this.getCapacity(agentProfileId);
  }

  // Skill-based routing
  async findAvailableAgent(
    departmentId?: number,
    requiredSkillIds?: number[],
    priority?: string,
  ): Promise<AgentProfile | null> {
    const qb = this.profileRepo
      .createQueryBuilder('agent')
      .leftJoinAndSelect('agent.skills', 'skills')
      .leftJoinAndSelect('agent.departments', 'departments')
      .leftJoin('escalated_agent_capacities', 'capacity', 'capacity.agentProfileId = agent.id')
      .where('agent.isActive = :isActive', { isActive: true })
      .andWhere('agent.isAvailable = :isAvailable', { isAvailable: true });

    if (departmentId) {
      qb.andWhere('departments.id = :departmentId', { departmentId });
    }

    if (requiredSkillIds?.length) {
      qb.andWhere('skills.id IN (:...skillIds)', { skillIds: requiredSkillIds });
    }

    // Respect capacity limits
    if (priority === 'urgent') {
      qb.andWhere('capacity.currentUrgent < capacity.maxUrgent');
    }
    qb.andWhere('capacity.currentTickets < capacity.maxTickets');

    // Prefer agents with least current tickets (round-robin-ish)
    qb.orderBy('capacity.currentTickets', 'ASC');

    return qb.getOne();
  }
}
