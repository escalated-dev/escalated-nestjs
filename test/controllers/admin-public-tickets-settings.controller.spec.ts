import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminSettingsController } from '../../src/controllers/admin/settings.controller';
import { SettingsService } from '../../src/services/settings.service';
import { DepartmentService } from '../../src/services/department.service';
import { TagService } from '../../src/services/tag.service';
import { CustomFieldService } from '../../src/services/custom-field.service';
import { RoleService } from '../../src/services/role.service';
import { AuditLogService } from '../../src/services/audit-log.service';
import { AuditLog } from '../../src/entities/audit-log.entity';
import { AuditLogInterceptor } from '../../src/interceptors/audit-log.interceptor';

/**
 * Tests for the dedicated GET + PUT /escalated/admin/settings/public-tickets
 * endpoints. The controller writes to a single `guest_policy` JSON blob via
 * SettingsService so the widget controller's existing
 * `getTyped('guest_policy')` lookup keeps working. Exercises the validation
 * + mode-switch-cleanup contract shared with the 10 host-framework ports.
 */
describe('AdminSettingsController — public-tickets endpoints', () => {
  let controller: AdminSettingsController;
  let store: Map<string, unknown>;
  let settingsService: any;

  beforeEach(async () => {
    store = new Map();
    settingsService = {
      getTyped: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      setMany: jest.fn(),
      getAll: jest.fn().mockResolvedValue([]),
    };

    const stub = <T>() => ({}) as T;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSettingsController],
      providers: [
        { provide: SettingsService, useValue: settingsService },
        { provide: DepartmentService, useValue: stub<DepartmentService>() },
        { provide: TagService, useValue: stub<TagService>() },
        { provide: CustomFieldService, useValue: stub<CustomFieldService>() },
        { provide: RoleService, useValue: stub<RoleService>() },
        { provide: AuditLogService, useValue: stub<AuditLogService>() },
        { provide: getRepositoryToken(AuditLog), useValue: { save: jest.fn() } },
      ],
    })
      .overrideInterceptor(AuditLogInterceptor)
      .useValue({ intercept: (_ctx: any, next: any) => next.handle() })
      .compile();

    controller = module.get(AdminSettingsController);
  });

  it('returns defaults when no guest_policy has been stored', async () => {
    const result = await controller.getPublicTicketsSettings();
    expect(result).toEqual({
      guest_policy_mode: 'unassigned',
      guest_policy_user_id: null,
      guest_policy_signup_url_template: '',
    });
  });

  it('persists guest_user mode with user id and clears template', async () => {
    const result = await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'guest_user',
      guest_policy_user_id: 42,
      guest_policy_signup_url_template: 'https://ignored.example',
    });

    expect(result).toEqual({
      guest_policy_mode: 'guest_user',
      guest_policy_user_id: 42,
      guest_policy_signup_url_template: '',
    });
    // Under the hood, the stored object is the camelCase module-option shape
    // the widget controller reads.
    expect(store.get('guest_policy')).toEqual({ mode: 'guest_user', guestUserId: 42 });
  });

  it('persists prompt_signup mode with template and clears user id', async () => {
    const template = 'https://app.example.com/signup?from_ticket={token}';
    const result = await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'prompt_signup',
      guest_policy_user_id: 99,
      guest_policy_signup_url_template: template,
    });

    expect(result).toEqual({
      guest_policy_mode: 'prompt_signup',
      guest_policy_user_id: null,
      guest_policy_signup_url_template: template,
    });
    expect(store.get('guest_policy')).toEqual({
      mode: 'prompt_signup',
      signupUrlTemplate: template,
    });
  });

  it('coerces unknown mode values to unassigned', async () => {
    const result = await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'bogus',
      guest_policy_user_id: 5,
      guest_policy_signup_url_template: 'ignored',
    });

    expect(result.guest_policy_mode).toBe('unassigned');
    expect(result.guest_policy_user_id).toBeNull();
    expect(result.guest_policy_signup_url_template).toBe('');
    expect(store.get('guest_policy')).toEqual({ mode: 'unassigned' });
  });

  it('truncates signup URL templates longer than 500 chars', async () => {
    const long = 'x'.repeat(1000);
    await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'prompt_signup',
      guest_policy_signup_url_template: long,
    });

    const stored = store.get('guest_policy') as Record<string, unknown>;
    expect((stored.signupUrlTemplate as string).length).toBe(500);
  });

  it('zero user id is stored as empty (surfaces as null on GET)', async () => {
    const result = await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'guest_user',
      guest_policy_user_id: 0,
    });

    expect(result.guest_policy_user_id).toBeNull();
    expect(store.get('guest_policy')).toEqual({ mode: 'guest_user' });
  });

  it('mode switch from guest_user to unassigned clears stale user id', async () => {
    await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'guest_user',
      guest_policy_user_id: 42,
    });
    expect((store.get('guest_policy') as any).guestUserId).toBe(42);

    const result = await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'unassigned',
    });

    expect(result.guest_policy_mode).toBe('unassigned');
    expect(result.guest_policy_user_id).toBeNull();
    expect(store.get('guest_policy')).toEqual({ mode: 'unassigned' });
  });

  it('GET returns latest state after multiple PUTs', async () => {
    await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'guest_user',
      guest_policy_user_id: 7,
    });
    await controller.updatePublicTicketsSettings({
      guest_policy_mode: 'guest_user',
      guest_policy_user_id: 15,
    });

    const result = await controller.getPublicTicketsSettings();
    expect(result.guest_policy_mode).toBe('guest_user');
    expect(result.guest_policy_user_id).toBe(15);
  });
});
