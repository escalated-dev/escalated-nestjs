import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessSchedule } from '../entities/business-schedule.entity';
import { Holiday } from '../entities/holiday.entity';
import { SlaPolicy } from '../entities/sla-policy.entity';
import { Department } from '../entities/department.entity';
import { isWithinBusinessHours } from './business-hours';

@Injectable()
export class BusinessScheduleService {
  constructor(
    @InjectRepository(BusinessSchedule)
    private readonly scheduleRepo: Repository<BusinessSchedule>,
    @InjectRepository(Holiday)
    private readonly holidayRepo: Repository<Holiday>,
  ) {}

  async findAll(): Promise<BusinessSchedule[]> {
    return this.scheduleRepo.find({ relations: { holidays: true } });
  }

  async findById(id: number): Promise<BusinessSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id },
      relations: { holidays: true },
    });
    if (!schedule) throw new NotFoundException(`Business schedule #${id} not found`);
    return schedule;
  }

  async create(data: Partial<BusinessSchedule>): Promise<BusinessSchedule> {
    const schedule = this.scheduleRepo.create(data);
    return this.scheduleRepo.save(schedule);
  }

  async update(id: number, data: Partial<BusinessSchedule>): Promise<BusinessSchedule> {
    await this.findById(id);
    await this.scheduleRepo.update(id, data);
    return this.findById(id);
  }

  /** Deletes a schedule and clears it from the policies and departments that used it. */
  async delete(id: number): Promise<void> {
    const schedule = await this.findById(id);
    const manager = this.scheduleRepo.manager;
    await manager.getRepository(SlaPolicy).update({ businessScheduleId: id }, {
      businessScheduleId: null,
    } as any);
    await manager.getRepository(Department).update(
      { businessScheduleId: id },
      {
        businessScheduleId: null,
      },
    );
    await this.scheduleRepo.remove(schedule);
  }

  async addHoliday(scheduleId: number, data: Partial<Holiday>): Promise<Holiday> {
    await this.findById(scheduleId);
    return this.holidayRepo.save({ ...data, businessScheduleId: scheduleId });
  }

  async removeHoliday(holidayId: number): Promise<void> {
    const holiday = await this.holidayRepo.findOne({ where: { id: holidayId } });
    if (!holiday) throw new NotFoundException(`Holiday #${holidayId} not found`);
    await this.holidayRepo.remove(holiday);
  }

  /** Whether `date` falls inside one of the schedule's windows, in its zone and holidays. */
  isWithinBusinessHours(schedule: BusinessSchedule, date: Date): boolean {
    return isWithinBusinessHours(date, schedule);
  }
}
