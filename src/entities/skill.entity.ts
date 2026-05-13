import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
  OneToMany,
} from 'typeorm';
import { Tag } from './tag.entity';
import { Department } from './department.entity';
import { AgentSkill } from './agent-skill.entity';

@Entity('escalated_skills')
export class Skill {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToMany(() => Tag)
  @JoinTable({
    name: 'escalated_skill_routing_tags',
    joinColumn: { name: 'skillId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tagId', referencedColumnName: 'id' },
  })
  routingTags: Tag[];

  @ManyToMany(() => Department)
  @JoinTable({
    name: 'escalated_skill_routing_departments',
    joinColumn: { name: 'skillId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'departmentId', referencedColumnName: 'id' },
  })
  routingDepartments: Department[];

  @OneToMany(() => AgentSkill, (agentSkill) => agentSkill.skill, {
    cascade: ['insert', 'update'],
  })
  agentSkills: AgentSkill[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
