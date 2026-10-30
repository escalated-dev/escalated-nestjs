import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Optional,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequiresAccessFeature } from '../../access/access-feature.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { SSO_JWT_ALGORITHMS, SsoService } from '../../services/sso.service';
import { back, inertia } from '../../ui/inertia';
import { EscalatedUi, UiValidationException } from '../../ui/inertia.interceptor';
import { isScriptedRequest, wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';

/** The placeholder the page shows for a stored secret (escalated-laravel's SecretMask). */
export const SECRET_MASK = '********';
const SECRET_KEYS = ['sso_jwt_secret', 'sso_oauth_client_secret'];

function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && /^.{0,3}\*{3,}$/.test(value);
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Admin > Settings > SSO (`Escalated/Admin/Settings/SsoSettings`), 404 while
 * `access.sso` is off. The provider and its fields are runtime settings; the
 * page also shows the endpoints to give the identity provider. Stored secrets
 * are sent as a mask, and the mask posted back keeps them.
 */
@UseGuards(EscalatedAdminGuard)
@EscalatedUi()
@Controller('escalated/admin/settings/sso')
export class SsoSettingsController {
  constructor(
    private readonly sso: SsoService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions = {},
  ) {}

  @Get()
  @RequiresAccessFeature('sso')
  async index(@Req() req: any) {
    const settings = await this.sso.config();
    for (const key of SECRET_KEYS) settings[key] = settings[key] ? SECRET_MASK : '';
    const props = { settings, endpoints: this.sso.endpoints(req) };
    return wantsPage(this.options, req)
      ? inertia('Escalated/Admin/Settings/SsoSettings', props)
      : props;
  }

  @Post()
  @HttpCode(200)
  @RequiresAccessFeature('sso')
  async update(@Body() body: any, @Req() req: any) {
    const screen = wantsPage(this.options, req);
    if (screen && !isScriptedRequest(req)) {
      throw new ForbiddenException('Screen forms must be sent by the Escalated client');
    }
    const input: Record<string, string> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      if (key.startsWith('sso_') && (typeof value === 'string' || value === null)) {
        input[key] = (value as string | null) ?? '';
      }
    }
    const errors = this.validate(input);
    if (Object.keys(errors).length) throw new UiValidationException(errors);

    for (const key of SECRET_KEYS) if (isMasked(input[key])) delete input[key];
    await this.sso.saveConfig(input);
    return screen
      ? back(routeUrl('escalated.admin.settings.sso'), { success: 'SSO settings updated.' })
      : { saved: true };
  }

  private validate(input: Record<string, string>): Record<string, string> {
    const errors: Record<string, string> = {};
    const provider = input.sso_provider ?? '';
    if (!['none', 'saml', 'oauth', 'jwt'].includes(provider)) {
      errors.sso_provider = 'The selected SSO provider is invalid.';
    }
    const urls = [
      'sso_url',
      'sso_login_url',
      'sso_logout_url',
      'sso_metadata_url',
      'sso_oauth_authorize_url',
      'sso_oauth_token_url',
      'sso_oauth_userinfo_url',
    ];
    for (const key of urls) {
      if (input[key] && (input[key].length > 500 || !isUrl(input[key]))) {
        errors[key] = 'This must be a valid URL.';
      }
    }
    if (input.sso_certificate && input.sso_certificate.length > 10000) {
      errors.sso_certificate = 'The certificate is too long.';
    }
    if (input.sso_jwt_algorithm && !SSO_JWT_ALGORITHMS.includes(input.sso_jwt_algorithm)) {
      errors.sso_jwt_algorithm = 'The selected algorithm is invalid.';
    }
    const required = (keys: string[]) => {
      for (const key of keys) if (!input[key]?.trim()) errors[key] ??= 'This field is required.';
    };
    if (provider === 'saml') required(['sso_entity_id', 'sso_login_url']);
    if (provider === 'jwt') required(['sso_url', 'sso_jwt_secret']);
    if (provider === 'oauth') {
      required([
        'sso_oauth_authorize_url',
        'sso_oauth_token_url',
        'sso_oauth_userinfo_url',
        'sso_oauth_client_id',
      ]);
    }
    return errors;
  }
}
