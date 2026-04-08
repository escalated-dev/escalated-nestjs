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
} from '@nestjs/common';
import { WebhookService } from '../../services/webhook.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

@Controller('escalated/admin/webhooks')
@UseInterceptors(AuditLogInterceptor)
export class AdminWebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Get()
  async list() {
    return this.webhookService.findAll();
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number) {
    return this.webhookService.findById(id);
  }

  @Post()
  @AuditAction('create', 'webhook')
  async create(@Body() body: any) {
    return this.webhookService.create(body);
  }

  @Put(':id')
  @AuditAction('update', 'webhook')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.webhookService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'webhook')
  async destroy(@Param('id', ParseIntPipe) id: number) {
    await this.webhookService.delete(id);
  }

  @Get(':id/deliveries')
  async deliveries(@Param('id', ParseIntPipe) id: number) {
    return this.webhookService.getDeliveries(id);
  }
}
