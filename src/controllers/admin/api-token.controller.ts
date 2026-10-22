import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  ParseIntPipe,
  HttpCode,
  UseGuards,
  Inject,
  Optional,
} from '@nestjs/common';
import { ApiTokenService } from '../../services/api-token.service';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { requireUserId } from '../../config/request-user';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { apiTokenInput } from '../../ui/admin-people';
import { back, inertia } from '../../ui/inertia';
import { BrowserFormGuard, EscalatedUi, UiValidationException } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { UiDataService } from '../../ui/ui-data.service';

/**
 * API tokens as a JSON API. With `ui.enabled`, also
 * `Escalated/Admin/ApiTokens/Index`, as escalated-laravel's
 * Admin\ApiTokenController serves it: a new token is shown once, in the
 * `plain_text_token` flash value of the redirect back.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin/api-tokens')
@EscalatedUi()
export class AdminApiTokenController {
  constructor(
    private readonly apiTokenService: ApiTokenService,
    @Optional() private readonly ui?: UiDataService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return !!this.ui && wantsPage(this.options, req);
  }

  @Get()
  async list(@Req() req: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/ApiTokens/Index', {
        tokens: await this.ui!.adminApiTokens(),
        users: await this.ui!.agentOptions(),
        // Tokens authenticate wherever the host applies the exported ApiTokenGuard.
        api_enabled: true,
      });
    }
    const userId = req.user?.id || req.apiUserId;
    return this.apiTokenService.findAll(userId);
  }

  @Post()
  async create(
    @Body() body: { name: string; abilities?: string[]; expiresAt?: string } & Record<string, any>,
    @Req() req: any,
  ): Promise<any> {
    if (this.screen(req)) {
      const input = apiTokenInput(body);
      const agents = await this.ui!.agentOptions();
      if (!agents.some((agent) => String(agent.id) === String(input.userId))) {
        throw new UiValidationException({ user_id: 'Choose an agent for the token.' });
      }
      const { plainTextToken } = await this.apiTokenService.create(input);
      return back(routeUrl('escalated.admin.api-tokens.index'), {
        success: 'API token created.',
        plain_text_token: plainTextToken,
      });
    }
    const userId = requireUserId(req);
    return this.apiTokenService.create({
      name: body.name,
      userId,
      abilities: body.abilities,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
  }

  @Post(':id/revoke')
  async revoke(@Param('id', ParseIntPipe) id: number) {
    await this.apiTokenService.revoke(id);
    return { success: true };
  }

  @Delete(':id')
  @HttpCode(204)
  async destroy(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.apiTokenService.delete(id);
    if (this.screen(req)) {
      return back(routeUrl('escalated.admin.api-tokens.index'), { success: 'Token revoked.' });
    }
  }
}
