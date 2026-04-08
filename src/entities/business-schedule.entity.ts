import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Holiday } from './holiday.entity';

@Entity('escalated_business_schedules')
export class BusinessSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100, default: 'UTC' })
  timezone: string;

  @Column({ default: false })
  isDefault: boolean;

  // Each day: { start: '09:00', end: '17:00', enabled: true }
  @Column({ type: 'simple-json' })
  schedule: {
    monday: { start: string; end: string; enabled: boolean };
    tuesday: { start: string; end: string; enabled: boolean };
    wednesday: { start: string; end: string; enabled: boolean };
    thursday: { start: string; end: string; enabled: boolean };
    friday: { start: string; end: string; enabled: boolean };
    saturday: { start: string; end: string; enabled: boolean };
    sunday: { start: string; end: string; enabled: boolean };
  };

  @OneToMany(() => Holiday, (h) => h.businessSchedule)
  holidays: Holiday[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
