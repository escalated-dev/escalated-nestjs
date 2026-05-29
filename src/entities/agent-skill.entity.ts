import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Skill } from './skill.entity';
import { userIdColumn, UserId } from '../config/user-id-column';

@Entity('escalated_agent_skills')
@Unique(['userId', 'skillId'])
@Index(['skillId'])
export class AgentSkill {
  @PrimaryGeneratedColumn()
  id: number;

  @Column(userIdColumn())
  userId: UserId;

  @Column({ type: 'int' })
  skillId: number;

  // Proficiency is a 1–5 self-rating used by the SkillRoutingService to break
  // ties when multiple agents possess the same required skill.
  @Column({ type: 'smallint', default: 3 })
  proficiency: number;

  @ManyToOne(() => Skill, (skill) => skill.agentSkills, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'skillId' })
  skill: Skill;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
