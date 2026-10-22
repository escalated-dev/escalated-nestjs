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
  NotFoundException,
  Optional,
  Query,
  Req,
} from '@nestjs/common';
import { WebhookService } from '../../services/webhook.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { availableWebhookEvents, serializeWebhook, webhookInput } from '../../ui/admin-config';
import { inertia, redirect } from '../../ui/inertia';
import { BrowserFormGuard, EscalatedUi } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { uiEnabled } from '../../ui/ui-options';
import { UiDataService } from '../../ui/ui-data.service';

/**
 * Webhooks as a JSON API. With `ui.enabled`, also the Webhooks screens
 * (`Admin/Webhooks/Index`, `Form`, `DeliveryLog`), as escalated-laravel's
 * Admin\WebhookController serves them, answering their forms with redirects.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin/webhooks')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminWebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    @Optional() private readonly ui?: UiDataService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return !!this.ui && wantsPage(this.options, req);
  }

  private toIndex(message: string) {
    return redirect(routeUrl('escalated.admin.webhooks.index'), { success: message });
  }

  private form(webhook: unknown) {
    return inertia('Escalated/Admin/Webhooks/Form', {
      webhook,
      availableEvents: availableWebhookEvents(),
    });
  }

  @Get()
  async list(@Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Webhooks/Index', {
        webhooks: await this.ui!.adminWebhooks(),
      });
    }
    return this.webhookService.findAll();
  }

  /** The new-webhook screen (`ui.enabled` only). Declared before `:id`. */
  @Get('create')
  create() {
    if (!uiEnabled(this.options)) throw new NotFoundException();
    return this.form(null);
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number) {
    return this.webhookService.findById(id);
  }

  /** The edit screen (`ui.enabled` only). */
  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number) {
    if (!uiEnabled(this.options)) throw new NotFoundException();
    return this.form(serializeWebhook(await this.webhookService.findById(id)));
  }

  @Post()
  @AuditAction('create', 'webhook')
  async store(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      await this.webhookService.create(webhookInput(body));
      return this.toIndex('Webhook created.');
    }
    return this.webhookService.create(body);
  }

  @Put(':id')
  @AuditAction('update', 'webhook')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      // Keeps the webhook's name; the screen has no name field.
      const input = webhookInput(body);
      delete input.name;
      await this.webhookService.update(id, input);
      return this.toIndex('Webhook updated.');
    }
    return this.webhookService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'webhook')
  async destroy(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.webhookService.delete(id);
    if (this.screen(req)) return this.toIndex('Webhook deleted.');
  }

  @Get(':id/deliveries')
  async deliveries(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      const webhook = await this.webhookService.findById(id);
      return inertia('Escalated/Admin/Webhooks/DeliveryLog', {
        webhook: serializeWebhook(webhook),
        deliveries: await this.ui!.webhookDeliveries(
          id,
          page,
          routeUrl('escalated.admin.webhooks.deliveries', { webhook: id }),
        ),
      });
    }
    return this.webhookService.getDeliveries(id);
  }
}
