import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Skill } from './skill.entity';
import { Department } from './department.entity';

@Entity('escalated_agent_profiles')
export class AgentProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  userId: number;

  @Column({ length: 255, nullable: true })
  displayName: string;

  @Column({ length: 255, nullable: true })
  avatar: string;

  @Column({ length: 500, nullable: true })
  signature: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isAvailable: boolean;

  @Column({ type: 'int', nullable: true })
  roleId: number;

  // 2FA
  @Column({ default: false })
  twoFactorEnabled: boolean;

  @Column({ length: 255, nullable: true })
  twoFactorSecret: string;

  @Column({ type: 'simple-json', nullable: true })
  twoFactorRecoveryCodes: string[];

  @ManyToMany(() => Skill)
  @JoinTable({
    name: 'escalated_agent_skills',
    joinColumn: { name: 'agentProfileId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'skillId', referencedColumnName: 'id' },
  })
  skills: Skill[];

  @ManyToMany(() => Department)
  @JoinTable({
    name: 'escalated_agent_departments',
    joinColumn: { name: 'agentProfileId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'departmentId', referencedColumnName: 'id' },
  })
  departments: Department[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
