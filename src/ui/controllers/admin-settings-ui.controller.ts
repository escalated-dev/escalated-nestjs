import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { userKeyType } from '../../config/user-id-column';
import { Ticket } from '../../entities/ticket.entity';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { DataRetentionService } from '../../services/data-retention.service';
import { resolveGuestPolicy } from '../../services/guest-policy';
import { SettingsService } from '../../services/settings.service';
import { back, inertia } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { isInertiaRequest } from '../request';
import { routeUrl } from '../routes';

const DEFAULT_CSAT_QUESTION = 'How would you rate your support experience?';
const CSAT_SCALES = ['1-3', '1-5'];
const CSAT_TRIGGERS = ['on_resolve', 'delayed', 'manual'];
const RETENTION_PERIODS = ['never', '1_year', '2_years', '3_years', '5_years'];
const AUDIT_RETENTION_PERIODS = ['never', '90_days', '180_days', '365_days'];
const DKIM_STATUSES = ['verified', 'pending', 'failed', 'unknown'];
const GUEST_POLICY_MODES = ['unassigned', 'guest_user', 'prompt_signup'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TABLE_PREFIX = 'escalated_';

/** The connection a module with no `connection` option uses. */
export const DEFAULT_CONNECTION = 'default';

function text(value: unknown): string | null {
  if (value == null) return null;
  const out = String(value).trim();
  return out === '' ? null : out;
}

function isEmail(value: string): boolean {
  return value.length <= 255 && EMAIL.test(value);
}

/** An address as the page reads it: exactly these four keys. */
function normaliseAddress(entry: Record<string, unknown>) {
  const department = entry.department_id;
  let departmentId: number | null = null;
  if (typeof department === 'number' && Number.isInteger(department)) departmentId = department;
  else if (typeof department === 'string' && /^-?\d+$/.test(department.trim()))
    departmentId = Number(department.trim());
  return {
    email: typeof entry.email === 'string' ? entry.email : '',
    display_name:
      typeof entry.display_name === 'string' && entry.display_name !== ''
        ? entry.display_name
        : null,
    department_id: departmentId,
    dkim_status:
      typeof entry.dkim_status === 'string' && entry.dkim_status !== ''
        ? entry.dkim_status
        : 'unknown',
  };
}

/**
 * The admin Settings sub-pages, with escalated-laravel's routes, props,
 * validation and flash messages (`CsatSettingsController`,
 * `DataRetentionController`, `DatabaseConnectionController`,
 * `EmailSettingsController`, `PublicTicketsSettingsController`). Values live in
 * the settings table under Laravel's keys; the public-tickets page reads and
 * writes the `guest_policy` setting the widget resolves.
 */
@UseGuards(EscalatedAdminGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/admin/settings')
export class AdminSettingsUiController {
  constructor(
    private readonly settings: SettingsService,
    private readonly retention: DataRetentionService,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  private async setting(key: string, fallback: string): Promise<string> {
    const value = await this.settings.get(key);
    return value == null || value === '' ? fallback : value;
  }

  // CSAT

  @Get('csat')
  async csat() {
    const delay = Number.parseInt(await this.setting('csat_delay_hours', '0'), 10);
    return inertia('Escalated/Admin/Settings/CsatSettings', {
      settings: {
        csat_question_text: await this.setting('csat_question_text', DEFAULT_CSAT_QUESTION),
        csat_scale: await this.setting('csat_scale', '1-5'),
        csat_delivery_trigger: await this.setting('csat_delivery_trigger', 'on_resolve'),
        csat_delay_hours: Number.isFinite(delay) ? delay : 0,
      },
    });
  }

  @Post('csat')
  @HttpCode(200)
  async updateCsat(@Body() body: any) {
    const errors: Record<string, string> = {};
    const question = text(body?.csat_question_text);
    if (question === null) errors.csat_question_text = 'The csat question text field is required.';
    else if (question.length > 500)
      errors.csat_question_text =
        'The csat question text field must not be greater than 500 characters.';
    const scale = text(body?.csat_scale);
    if (!scale || !CSAT_SCALES.includes(scale))
      errors.csat_scale = 'The selected csat scale is invalid.';
    const trigger = text(body?.csat_delivery_trigger);
    if (!trigger || !CSAT_TRIGGERS.includes(trigger))
      errors.csat_delivery_trigger = 'The selected csat delivery trigger is invalid.';
    const delay = text(body?.csat_delay_hours);
    if (delay === null) errors.csat_delay_hours = 'The csat delay hours field is required.';
    else if (!/^-?\d+$/.test(delay))
      errors.csat_delay_hours = 'The csat delay hours field must be an integer.';
    else if (Number(delay) < 0 || Number(delay) > 168)
      errors.csat_delay_hours = 'The csat delay hours field must be between 0 and 168.';
    if (Object.keys(errors).length) throw new UiValidationException(errors);

    await this.settings.set('csat_question_text', question, 'string', 'csat');
    await this.settings.set('csat_scale', scale, 'string', 'csat');
    await this.settings.set('csat_delivery_trigger', trigger, 'string', 'csat');
    await this.settings.set('csat_delay_hours', String(Number(delay)), 'string', 'csat');
    return back(routeUrl('escalated.admin.settings.csat'), { success: 'CSAT settings updated.' });
  }

  // Data retention

  @Get('data-retention')
  async dataRetention() {
    const gdpr = await this.settings.get('retention_user_data_gdpr', '0');
    return inertia('Escalated/Admin/Settings/DataRetention', {
      settings: {
        retention_closed_tickets: await this.setting('retention_closed_tickets', 'never'),
        retention_attachments: await this.setting('retention_attachments', 'never'),
        retention_audit_logs: await this.setting('retention_audit_logs', 'never'),
        retention_user_data_gdpr: gdpr === '1' || gdpr === 'true',
      },
      purgePreview: await this.retention.preview(),
    });
  }

  @Post('data-retention')
  @HttpCode(200)
  async updateDataRetention(@Body() body: any) {
    const errors: Record<string, string> = {};
    const values: Record<string, string> = {};
    const periods: Array<[string, string[]]> = [
      ['retention_closed_tickets', RETENTION_PERIODS],
      ['retention_attachments', RETENTION_PERIODS],
      ['retention_audit_logs', AUDIT_RETENTION_PERIODS],
    ];
    for (const [key, allowed] of periods) {
      const value = text(body?.[key]);
      const label = key.replace(/_/g, ' ');
      if (value === null) errors[key] = `The ${label} field is required.`;
      else if (!allowed.includes(value)) errors[key] = `The selected ${label} is invalid.`;
      else values[key] = value;
    }
    const gdpr = body?.retention_user_data_gdpr;
    if (gdpr === undefined || gdpr === null || gdpr === '')
      errors.retention_user_data_gdpr = 'The retention user data gdpr field is required.';
    else if ([true, 1, '1', 'true'].includes(gdpr)) values.retention_user_data_gdpr = '1';
    else if ([false, 0, '0', 'false'].includes(gdpr)) values.retention_user_data_gdpr = '0';
    else
      errors.retention_user_data_gdpr = 'The retention user data gdpr field must be true or false.';
    if (Object.keys(errors).length) throw new UiValidationException(errors);

    for (const [key, value] of Object.entries(values)) {
      await this.settings.set(key, value, 'string', 'data_retention');
    }
    return back(routeUrl('escalated.admin.settings.data-retention'), {
      success: 'Data retention settings updated.',
    });
  }

  // Database connection (read-only)

  private connectionName(): string {
    return this.options?.connection ?? DEFAULT_CONNECTION;
  }

  /**
   * Laravel's `ConnectionInspector` description of the DataSource Escalated's
   * repositories use. A failed probe is reported, never thrown.
   */
  private async describeConnection() {
    const name = this.connectionName();
    const source = this.tickets.manager.connection;
    const options = source.options as Record<string, any>;
    const description: Record<string, unknown> = {
      name,
      driver: String(options.type ?? ''),
      database: null,
      is_current: true,
      is_host_default: name === DEFAULT_CONNECTION,
      reachable: false,
      migrated: false,
      ticket_count: null,
      error: null,
    };

    let database: string | null = null;
    if (typeof options.url === 'string') {
      try {
        const url = new URL(options.url);
        database = `${url.pathname.replace(/^\//, '')} @ ${url.host}`;
      } catch {
        database = null;
      }
    } else if (options.database) {
      database = options.host
        ? `${options.database} @ ${options.host}${options.port ? `:${options.port}` : ''}`
        : String(options.database);
    }
    description.database = database;

    try {
      if (!source.isInitialized) throw new Error('The connection is not initialized.');
      await source.query('SELECT 1');
      description.reachable = true;
    } catch (error) {
      description.error = error instanceof Error ? error.message : String(error);
      return description;
    }
    try {
      description.ticket_count = await this.tickets.count();
      description.migrated = true;
    } catch {
      // Reachable without the tickets table: not migrated, as Laravel reports it.
    }
    return description;
  }

  @Get('database')
  async database() {
    return inertia('Escalated/Admin/Settings/DatabaseConnection', {
      connections: [await this.describeConnection()],
      current: this.connectionName(),
      hostDefault: DEFAULT_CONNECTION,
      pinnedByConfig: true,
      tablePrefix: TABLE_PREFIX,
    });
  }

  /** The connection is the module's `connection` option, so it never switches from here. */
  @Post('database')
  @HttpCode(200)
  updateDatabase() {
    return back(routeUrl('escalated.admin.settings.database'), {
      error:
        'The database connection is set in configuration (the connection module option) and cannot be changed from here.',
    });
  }

  @Post('database/test')
  @HttpCode(200)
  async testDatabase(@Body() body: any, @Req() req: any) {
    const name = text(body?.connection);
    if (name === null)
      throw new UiValidationException({ connection: 'The connection field is required.' });
    if (name.length > 64)
      throw new UiValidationException({
        connection: 'The connection field must not be greater than 64 characters.',
      });
    if (name !== this.connectionName())
      throw new UiValidationException({ connection: `[${name}] is not a configured connection.` });

    const description = await this.describeConnection();
    if (!isInertiaRequest(req)) return description;
    return back(
      routeUrl('escalated.admin.settings.database'),
      description.reachable
        ? { success: `Connected to [${name}].` }
        : { error: `Could not connect to [${name}]: ${description.error}` },
    );
  }

  // Email addresses

  @Get('email')
  async email() {
    let addresses: ReturnType<typeof normaliseAddress>[] = [];
    try {
      const stored = JSON.parse((await this.settings.get('email_addresses')) || '[]');
      if (Array.isArray(stored)) {
        addresses = stored
          .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
          .map(normaliseAddress);
      }
    } catch {
      addresses = [];
    }
    return inertia('Escalated/Admin/Settings/EmailSettings', {
      addresses,
      defaultReplyAddress: (await this.settings.get('default_reply_address')) ?? '',
    });
  }

  /** As in Laravel, the addresses are stored only: outbound mail does not read them. */
  @Post('email')
  @HttpCode(200)
  async updateEmail(@Body() body: any) {
    const errors: Record<string, string> = {};
    const addresses: ReturnType<typeof normaliseAddress>[] = [];
    const list = body?.addresses;
    if (list === undefined || list === null) {
      errors.addresses = 'The addresses field is required.';
    } else if (!Array.isArray(list)) {
      errors.addresses = 'The addresses field must be an array.';
    } else {
      list.forEach((entry: any, index: number) => {
        const key = `addresses.${index}.`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors[`${key}email`] = 'The email field is required.';
          return;
        }
        const email = entry.email;
        if (typeof email !== 'string' || email.trim() === '')
          errors[`${key}email`] = 'The email field is required.';
        else if (email.length > 255)
          errors[`${key}email`] = 'The email field must not be greater than 255 characters.';
        else if (!isEmail(email))
          errors[`${key}email`] = 'The email field must be a valid email address.';
        const name = entry.display_name;
        if (name != null && typeof name !== 'string')
          errors[`${key}display_name`] = 'The display name field must be a string.';
        else if (typeof name === 'string' && name.length > 255)
          errors[`${key}display_name`] =
            'The display name field must not be greater than 255 characters.';
        const department = entry.department_id;
        const integral =
          department == null ||
          (typeof department === 'number' && Number.isInteger(department)) ||
          (typeof department === 'string' &&
            (department === '' || /^-?\d+$/.test(department.trim())));
        if (!integral)
          errors[`${key}department_id`] = 'The department id field must be an integer.';
        const dkim = entry.dkim_status;
        if (dkim != null && !(typeof dkim === 'string' && DKIM_STATUSES.includes(dkim)))
          errors[`${key}dkim_status`] = 'The selected dkim status is invalid.';
        addresses.push(normaliseAddress(entry));
      });
    }
    const reply = text(body?.default_reply_address);
    if (reply !== null && reply.length > 255)
      errors.default_reply_address =
        'The default reply address field must not be greater than 255 characters.';
    else if (reply !== null && !isEmail(reply))
      errors.default_reply_address =
        'The default reply address field must be a valid email address.';
    if (Object.keys(errors).length) throw new UiValidationException(errors);

    await this.settings.set('email_addresses', JSON.stringify(addresses), 'string', 'email');
    if (reply !== null) await this.settings.set('default_reply_address', reply, 'string', 'email');
    return back(routeUrl('escalated.admin.settings.email'), { success: 'Email settings updated.' });
  }

  // Public tickets (guest policy)

  @Get('public-tickets')
  async publicTickets() {
    const policy: any = await resolveGuestPolicy(this.settings, this.options ?? {});
    const mode = GUEST_POLICY_MODES.includes(policy?.mode) ? policy.mode : 'unassigned';
    return inertia('Escalated/Admin/Settings/PublicTickets', {
      settings: {
        guest_policy_mode: mode,
        guest_policy_user_id:
          mode === 'guest_user' && policy?.guestUserId != null ? String(policy.guestUserId) : null,
        guest_policy_signup_url_template:
          mode === 'prompt_signup' && typeof policy?.signupUrlTemplate === 'string'
            ? policy.signupUrlTemplate
            : '',
      },
    });
  }

  /** The page posts; Laravel's route is a PUT, so both are accepted. */
  @Post('public-tickets')
  @HttpCode(200)
  updatePublicTickets(@Body() body: any) {
    return this.savePublicTickets(body);
  }

  @Put('public-tickets')
  @HttpCode(200)
  putPublicTickets(@Body() body: any) {
    return this.savePublicTickets(body);
  }

  /** Saves the `guest_policy` setting the widget and guest routes resolve. */
  private async savePublicTickets(body: any) {
    const errors: Record<string, string> = {};
    const mode = text(body?.guest_policy_mode);
    if (mode === null) errors.guest_policy_mode = 'The guest policy mode field is required.';
    else if (!GUEST_POLICY_MODES.includes(mode))
      errors.guest_policy_mode = 'The selected guest policy mode is invalid.';
    const userId = text(body?.guest_policy_user_id);
    // Laravel: an integer of at least 1. Hosts keyed by UUID or string ids keep theirs.
    const numericIds = ['int', 'bigint'].includes(userKeyType());
    if (userId !== null && numericIds && !/^\d+$/.test(userId))
      errors.guest_policy_user_id = 'The guest policy user id field must be an integer.';
    else if (userId !== null && numericIds && Number(userId) < 1)
      errors.guest_policy_user_id = 'The guest policy user id field must be at least 1.';
    else if (mode === 'guest_user' && userId === null)
      errors.guest_policy_user_id =
        'The guest policy user id field is required when guest policy mode is guest_user.';
    const template = text(body?.guest_policy_signup_url_template);
    if (template !== null && template.length > 500)
      errors.guest_policy_signup_url_template =
        'The guest policy signup url template field must not be greater than 500 characters.';
    if (Object.keys(errors).length) throw new UiValidationException(errors);

    const policy =
      mode === 'guest_user'
        ? { mode, guestUserId: numericIds ? Number(userId) : userId }
        : mode === 'prompt_signup'
          ? { mode, ...(template !== null ? { signupUrlTemplate: template } : {}) }
          : { mode };
    await this.settings.set('guest_policy', policy, 'json', 'public_tickets');
    return back(routeUrl('escalated.admin.settings.public-tickets'), {
      success: 'Guest policy updated.',
    });
  }
}
