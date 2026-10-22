import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Holiday } from './holiday.entity';
import type { DayHours } from '../services/business-hours';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

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

  /**
   * Opening hours per weekday, as wall-clock times in `timezone`:
   * `{ monday: { start: '09:00', end: '17:00' }, ... }`. An empty start or
   * end, an equal start and end, or `enabled: false` closes the day; an end
   * before the start is an overnight window; `24:00` is midnight.
   */
  @Column({ type: 'simple-json' })
  schedule: Partial<Record<Weekday, DayHours>>;

  @OneToMany(() => Holiday, (h) => h.businessSchedule)
  holidays: Holiday[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
