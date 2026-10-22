import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as entities from '../../src/entities';
import { BusinessSchedule } from '../../src/entities/business-schedule.entity';
import { Department } from '../../src/entities/department.entity';
import { Holiday } from '../../src/entities/holiday.entity';
import { SlaPolicy } from '../../src/entities/sla-policy.entity';
import { Ticket } from '../../src/entities/ticket.entity';
import { BusinessScheduleService } from '../../src/services/business-schedule.service';
import { SlaService } from '../../src/services/sla.service';

/*
 * A business-hours policy counts in the policy's schedule, else the ticket
 * department's, else the default schedule. With none, deadlines are counted
 * in calendar time, as before.
 */
describe('SLA deadlines in business schedules', () => {
  let source: DataSource;
  let service: SlaService;
  let department: Department;
  let sequence = 0;
  // Monday 06:00 UTC.
  const createdAt = new Date('2026-10-26T06:00:00Z');

  beforeEach(async () => {
    source = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: Object.values(entities).filter((value) => typeof value === 'function'),
      synchronize: true,
    });
    await source.initialize();
    service = new SlaService(
      source.getRepository(SlaPolicy),
      source.getRepository(BusinessSchedule),
      source.getRepository(Ticket),
      { emit: () => true } as unknown as EventEmitter2,
      { options: { targetedSlas: true } } as any,
    );
    department = await source.getRepository(Department).save({ name: 'Ops', slug: 'ops' });
  });

  afterEach(async () => {
    await source?.destroy();
  });

  const schedule = (start: string, end: string, isDefault = false) =>
    source.getRepository(BusinessSchedule).save({
      name: `${start}-${end}`,
      timezone: 'UTC',
      isDefault,
      schedule: Object.fromEntries(
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => [
          day,
          { start, end },
        ]),
      ),
    });

  const policy = (data: Partial<SlaPolicy> = {}) =>
    source.getRepository(SlaPolicy).save({
      name: 'Business',
      isDefault: true,
      firstResponseMedium: 60,
      resolutionMedium: 180,
      ...data,
    });

  const departmentSchedule = async (start: string, end: string) =>
    source
      .getRepository(Department)
      .update(department.id, { businessScheduleId: (await schedule(start, end)).id });

  async function applied(departmentId: number | null = department.id) {
    const ticket = await source.getRepository(Ticket).save({
      referenceNumber: `BH-${++sequence}`,
      subject: 'Help',
      description: 'Please',
      requesterId: 1,
      priority: 'medium',
      departmentId,
      createdAt,
    } as Partial<Ticket>);
    await service.applyToTicket(ticket);
    const stored = await source.getRepository(Ticket).findOneByOrFail({ id: ticket.id });
    return {
      firstResponse: new Date(stored.firstResponseDueAt).toISOString().slice(0, 16),
      resolution: new Date(stored.resolutionDueAt).toISOString().slice(0, 16),
    };
  }

  it('counts in the policy schedule first', async () => {
    await schedule('07:00', '08:00', true);
    await departmentSchedule('13:00', '15:00');
    await policy({ businessScheduleId: (await schedule('10:00', '12:00')).id });

    expect(await applied()).toEqual({
      firstResponse: '2026-10-26T11:00',
      resolution: '2026-10-27T11:00',
    });
  });

  it('counts in the department schedule when the policy has none', async () => {
    await schedule('07:00', '08:00', true);
    await departmentSchedule('13:00', '15:00');
    await policy({ businessHoursOnly: true });

    expect((await applied()).firstResponse).toBe('2026-10-26T14:00');
  });

  it('counts in the default schedule when neither has one', async () => {
    await schedule('13:00', '15:00');
    await schedule('07:00', '08:00', true);
    await policy({ businessHoursOnly: true });

    expect((await applied()).firstResponse).toBe('2026-10-26T08:00');
    expect((await applied(null)).firstResponse).toBe('2026-10-26T08:00');
  });

  it('counts calendar time when no schedule applies', async () => {
    await schedule('07:00', '08:00'); // not the default, and nothing points at it
    await policy({ businessHoursOnly: true });

    expect(await applied()).toEqual({
      firstResponse: '2026-10-26T07:00',
      resolution: '2026-10-26T09:00',
    });
  });

  it('ignores schedules for a policy that is not limited to business hours', async () => {
    await schedule('07:00', '08:00', true);
    await departmentSchedule('13:00', '15:00');
    await policy();

    expect((await applied()).firstResponse).toBe('2026-10-26T07:00');
  });

  it('skips holidays of the chosen schedule', async () => {
    const office = await schedule('09:00', '17:00', true);
    await source
      .getRepository(Holiday)
      .save({ businessScheduleId: office.id, name: 'Closed', date: '2026-10-26' });
    await policy({ businessHoursOnly: true });

    expect((await applied()).firstResponse).toBe('2026-10-27T10:00');
  });

  it('clears a deleted schedule from policies and departments', async () => {
    const office = await schedule('09:00', '17:00');
    const saved = await policy({ businessScheduleId: office.id });
    await source.getRepository(Department).update(department.id, { businessScheduleId: office.id });

    await new BusinessScheduleService(
      source.getRepository(BusinessSchedule),
      source.getRepository(Holiday),
    ).delete(office.id);

    expect(
      (await source.getRepository(SlaPolicy).findOneByOrFail({ id: saved.id })).businessScheduleId,
    ).toBeNull();
    expect(
      (await source.getRepository(Department).findOneByOrFail({ id: department.id }))
        .businessScheduleId,
    ).toBeNull();
  });
});
