import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessSchedule } from '../entities/business-schedule.entity';
import { Holiday } from '../entities/holiday.entity';

@Injectable()
export class BusinessScheduleService {
  constructor(
    @InjectRepository(BusinessSchedule)
    private readonly scheduleRepo: Repository<BusinessSchedule>,
    @InjectRepository(Holiday)
    private readonly holidayRepo: Repository<Holiday>,
  ) {}

  async findAll(): Promise<BusinessSchedule[]> {
    return this.scheduleRepo.find({ relations: ['holidays'] });
  }

  async findById(id: number): Promise<BusinessSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id },
      relations: ['holidays'],
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

  async delete(id: number): Promise<void> {
    const schedule = await this.findById(id);
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

  isWithinBusinessHours(schedule: BusinessSchedule, date: Date): boolean {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = days[date.getDay()];
    const daySchedule = schedule.schedule[dayName];

    if (!daySchedule?.enabled) return false;

    const [startH, startM] = daySchedule.start.split(':').map(Number);
    const [endH, endM] = daySchedule.end.split(':').map(Number);

    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
}
