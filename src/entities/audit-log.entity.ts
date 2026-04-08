import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('escalated_audit_logs')
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  userId: number;

  @Column({ length: 100 })
  action: string; // create, update, delete, login, etc.

  @Column({ length: 100 })
  entityType: string; // ticket, reply, agent, etc.

  @Column({ type: 'int', nullable: true })
  entityId: number;

  @Column({ type: 'simple-json', nullable: true })
  oldValues: Record<string, any>;

  @Column({ type: 'simple-json', nullable: true })
  newValues: Record<string, any>;

  @Column({ length: 45, nullable: true })
  ipAddress: string;

  @Column({ length: 500, nullable: true })
  userAgent: string;

  @CreateDateColumn()
  createdAt: Date;
}
