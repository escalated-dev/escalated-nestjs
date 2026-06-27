import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotImplementedException,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ESCALATED_OPTIONS, EscalatedModuleOptions } from '../../config/escalated.config';

/**
 * General JSON API authentication for the Flutter app and integrations. All
 * credential handling is delegated to host-app callbacks (`options.apiAuth`) —
 * Escalated owns no passwords or sessions. An unconfigured callback responds
 * 501; a callback returning null is treated as an auth failure (401).
 */
@Controller('escalated/api/v1/auth')
export class ApiAuthController {
  constructor(@Inject(ESCALATED_OPTIONS) private readonly options: EscalatedModuleOptions) {}

  @Post('login')
  async login(@Body() body: Record<string, any>) {
    const cb = this.options.apiAuth?.authenticate;
    if (!cb) throw new NotImplementedException('Authentication is not configured');
    return this.wrap(await cb(body ?? {}));
  }

  @Post('register')
  async register(@Body() body: Record<string, any>) {
    const cb = this.options.apiAuth?.register;
    if (!cb) throw new NotImplementedException('Registration is not configured');
    return this.wrap(await cb(body ?? {}));
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const cb = this.options.apiAuth?.validate;
    if (!cb) throw new NotImplementedException('Authentication is not configured');
    return this.wrap(await cb(this.bearer(authorization)));
  }

  @Post('refresh')
  async refresh(@Headers('authorization') authorization?: string) {
    const cb = this.options.apiAuth?.refresh;
    if (!cb) throw new NotImplementedException('Token refresh is not configured');
    return this.wrap(await cb(this.bearer(authorization)));
  }

  @Patch('profile')
  async profile(@Headers('authorization') authorization: string | undefined, @Body() body: Record<string, any>) {
    const cb = this.options.apiAuth?.updateProfile;
    if (!cb) throw new NotImplementedException('Profile updates are not configured');
    return this.wrap(await cb(this.bearer(authorization), body ?? {}));
  }

  @Post('logout')
  async logout(@Headers('authorization') authorization?: string) {
    const cb = this.options.apiAuth?.logout;
    if (cb) await cb(this.bearer(authorization));
    return { data: { success: true } };
  }

  @Post('validate')
  async validate(@Body('token') token?: string) {
    if (!token) throw new BadRequestException('token is required');
    const cb = this.options.apiAuth?.validate;
    if (!cb) throw new NotImplementedException('Authentication is not configured');
    const user = await cb(token);
    if (!user) throw new UnauthorizedException('Invalid token');
    return { valid: true, user };
  }

  private wrap(result: Record<string, any> | null) {
    if (!result) throw new UnauthorizedException();
    return { data: result };
  }

  private bearer(authorization?: string): string {
    if (!authorization) return '';
    return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : authorization;
  }
}
