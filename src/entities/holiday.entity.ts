import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BusinessSchedule } from './business-schedule.entity';

@Entity('escalated_holidays')
export class Holiday {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => BusinessSchedule, (bs) => bs.holidays, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'businessScheduleId' })
  businessSchedule: BusinessSchedule;

  @Column()
  businessScheduleId: number;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ default: false })
  isRecurring: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
