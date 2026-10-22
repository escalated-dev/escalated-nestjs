import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  UseInterceptors,
  UseGuards,
  Inject,
  Optional,
  Req,
} from '@nestjs/common';
import { MacroService } from '../../services/macro.service';
import { CannedResponseService } from '../../services/canned-response.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import { cannedResponseInput, macroInput } from '../../ui/admin-config';
import { back, inertia } from '../../ui/inertia';
import { BrowserFormGuard, EscalatedUi } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { UiDataService } from '../../ui/ui-data.service';

/**
 * Macros and canned responses as a JSON API. With `ui.enabled`, the list
 * routes also serve `Escalated/Admin/Macros/Index` and
 * `Escalated/Admin/CannedResponses/Index`, and the writes answer those
 * screens with a redirect back, as escalated-laravel's admin controllers do.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminMacroController {
  constructor(
    private readonly macroService: MacroService,
    private readonly cannedResponseService: CannedResponseService,
    @Optional() private readonly ui?: UiDataService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return !!this.ui && wantsPage(this.options, req);
  }

  private backTo(name: string, message: string) {
    return back(routeUrl(name), { success: message });
  }

  // Macros
  @Get('macros')
  async listMacros(@Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Macros/Index', { macros: await this.ui!.adminMacros() });
    }
    return this.macroService.findAll();
  }

  @Get('macros/:id')
  async showMacro(@Param('id', ParseIntPipe) id: number) {
    return this.macroService.findById(id);
  }

  @Post('macros')
  @AuditAction('create', 'macro')
  async createMacro(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      await this.macroService.create({ ...macroInput(body), createdBy: requireUserId(req) });
      return this.backTo('escalated.admin.macros.index', 'Macro created.');
    }
    return this.macroService.create(body);
  }

  @Put('macros/:id')
  @AuditAction('update', 'macro')
  async updateMacro(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      await this.macroService.update(id, macroInput(body));
      return this.backTo('escalated.admin.macros.index', 'Macro updated.');
    }
    return this.macroService.update(id, body);
  }

  @Delete('macros/:id')
  @HttpCode(204)
  async deleteMacro(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.macroService.delete(id);
    if (this.screen(req)) return this.backTo('escalated.admin.macros.index', 'Macro deleted.');
  }

  // Canned Responses
  @Get('canned-responses')
  async listCannedResponses(@Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/CannedResponses/Index', {
        responses: await this.ui!.adminCannedResponses(),
      });
    }
    return this.cannedResponseService.findAll();
  }

  @Post('canned-responses')
  @AuditAction('create', 'canned_response')
  async createCannedResponse(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      await this.cannedResponseService.create({
        ...cannedResponseInput(body, true),
        createdBy: requireUserId(req),
      });
      return this.backTo('escalated.admin.canned-responses.index', 'Canned response created.');
    }
    return this.cannedResponseService.create(body);
  }

  @Put('canned-responses/:id')
  @AuditAction('update', 'canned_response')
  async updateCannedResponse(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      await this.cannedResponseService.update(id, cannedResponseInput(body));
      return this.backTo('escalated.admin.canned-responses.index', 'Canned response updated.');
    }
    return this.cannedResponseService.update(id, body);
  }

  @Delete('canned-responses/:id')
  @HttpCode(204)
  async deleteCannedResponse(
    @Param('id', ParseIntPipe) id: number,
    @Req() req?: any,
  ): Promise<any> {
    await this.cannedResponseService.delete(id);
    if (this.screen(req)) {
      return this.backTo('escalated.admin.canned-responses.index', 'Canned response deleted.');
    }
  }
}
