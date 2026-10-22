import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { AuditAction, AuditLogInterceptor } from '../../interceptors/audit-log.interceptor';
import {
  CUSTOM_FIELD_CONTEXTS,
  CustomFieldService,
  serializeCustomField,
} from '../../services/custom-field.service';
import {
  CustomObjectService,
  serializeCustomObject,
  serializeCustomObjectRecord,
} from '../../services/custom-object.service';
import { back, inertia, redirect } from '../../ui/inertia';
import { BrowserFormGuard, EscalatedUi } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { uiEnabled } from '../../ui/ui-options';

/**
 * Custom field definitions as a JSON API (unchanged: entity-shaped bodies and
 * responses). With `ui.enabled`, also `Admin/CustomFields/Index` and `Form`,
 * as escalated-laravel's Admin\CustomFieldController serves them, answering
 * their forms with redirects.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin/custom-fields')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminCustomFieldController {
  constructor(
    private readonly fields: CustomFieldService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return wantsPage(this.options, req);
  }

  private toIndex(message: string) {
    return redirect(routeUrl('escalated.admin.custom-fields.index'), { success: message });
  }

  private form(field: unknown) {
    return inertia('Escalated/Admin/CustomFields/Form', {
      field,
      contexts: [...CUSTOM_FIELD_CONTEXTS],
    });
  }

  @Get()
  async list(@Query('entityType') entityType?: string, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      return inertia('Escalated/Admin/CustomFields/Index', {
        fields: await this.fields.adminList(),
      });
    }
    return this.fields.findAll(entityType);
  }

  /** The new-field screen (`ui.enabled` only). Declared before `:id`. */
  @Get('create')
  create() {
    if (!uiEnabled(this.options)) throw new NotFoundException();
    return this.form(null);
  }

  /** The edit screen (`ui.enabled` only). */
  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number) {
    if (!uiEnabled(this.options)) throw new NotFoundException();
    return this.form(serializeCustomField(await this.fields.findById(id)));
  }

  @Post('reorder')
  @HttpCode(200)
  async reorder(@Body() body: any, @Req() req?: any): Promise<any> {
    await this.fields.reorder(body?.positions);
    if (this.screen(req)) {
      return back(routeUrl('escalated.admin.custom-fields.index'), {
        success: 'Fields reordered.',
      });
    }
    return { message: 'Fields reordered.' };
  }

  @Post()
  @AuditAction('create', 'custom_field')
  async store(@Body() body: any, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      await this.fields.adminCreate(body);
      return this.toIndex('Custom field created.');
    }
    return this.fields.create(body);
  }

  @Put(':id')
  @Patch(':id')
  @AuditAction('update', 'custom_field')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      await this.fields.adminUpdate(id, body);
      return this.toIndex('Custom field updated.');
    }
    return this.fields.update(id, body);
  }

  /** Deletes the field and its stored values. */
  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'custom_field')
  async destroy(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.fields.delete(id);
    if (this.screen(req)) return this.toIndex('Custom field deleted.');
  }
}

/**
 * Custom objects and their records (escalated-laravel's
 * Admin\CustomObjectController): JSON with Laravel's keys for API clients,
 * and with `ui.enabled` the `Admin/CustomObjects/Index`, `Form` and `Records`
 * screens. Record `data` is checked against the object's schema.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin/custom-objects')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminCustomObjectController {
  constructor(
    private readonly objects: CustomObjectService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return wantsPage(this.options, req);
  }

  private toIndex(message: string) {
    return redirect(routeUrl('escalated.admin.custom-objects.index'), { success: message });
  }

  private toRecords(id: number, message: string) {
    return back(routeUrl('escalated.admin.custom-objects.records', { custom_object: id }), {
      success: message,
    });
  }

  @Get()
  async list(@Req() req?: any): Promise<any> {
    const objects = await this.objects.list();
    if (this.screen(req)) return inertia('Escalated/Admin/CustomObjects/Index', { objects });
    return objects;
  }

  /** The new-object screen (`ui.enabled` only). Declared before `:id`. */
  @Get('create')
  create() {
    if (!uiEnabled(this.options)) throw new NotFoundException();
    return inertia('Escalated/Admin/CustomObjects/Form', { object: null });
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number) {
    return serializeCustomObject(await this.objects.find(id));
  }

  /** The edit screen (`ui.enabled` only). */
  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number) {
    if (!uiEnabled(this.options)) throw new NotFoundException();
    return inertia('Escalated/Admin/CustomObjects/Form', {
      object: serializeCustomObject(await this.objects.find(id)),
    });
  }

  @Post()
  @AuditAction('create', 'custom_object')
  async store(@Body() body: any, @Req() req?: any): Promise<any> {
    const object = await this.objects.create(body);
    if (this.screen(req)) return this.toIndex('Custom object created.');
    return serializeCustomObject(object);
  }

  @Put(':id')
  @Patch(':id')
  @AuditAction('update', 'custom_object')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    const object = await this.objects.update(id, body);
    if (this.screen(req)) return this.toIndex('Custom object updated.');
    return serializeCustomObject(object);
  }

  /** Deletes the object and its records. */
  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'custom_object')
  async destroy(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.objects.delete(id);
    if (this.screen(req)) return this.toIndex('Custom object deleted.');
  }

  /** The object's records, newest first. */
  @Get(':id/records')
  async records(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    const object = await this.objects.find(id);
    const props = {
      object: serializeCustomObject(object),
      records: await this.objects.recordsOf(object),
    };
    if (this.screen(req)) return inertia('Escalated/Admin/CustomObjects/Records', props);
    return props;
  }

  @Post(':id/records')
  async storeRecord(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    const record = await this.objects.createRecord(id, body?.data);
    if (this.screen(req)) return this.toRecords(id, 'Record created.');
    return serializeCustomObjectRecord(record);
  }

  @Put(':id/records/:record')
  @Patch(':id/records/:record')
  async updateRecord(
    @Param('id', ParseIntPipe) id: number,
    @Param('record', ParseIntPipe) recordId: number,
    @Body() body: any,
    @Req() req?: any,
  ): Promise<any> {
    const record = await this.objects.updateRecord(id, recordId, body?.data);
    if (this.screen(req)) return this.toRecords(id, 'Record updated.');
    return serializeCustomObjectRecord(record);
  }

  @Delete(':id/records/:record')
  @HttpCode(204)
  async destroyRecord(
    @Param('id', ParseIntPipe) id: number,
    @Param('record', ParseIntPipe) recordId: number,
    @Req() req?: any,
  ): Promise<any> {
    await this.objects.deleteRecord(id, recordId);
    if (this.screen(req)) return this.toRecords(id, 'Record deleted.');
  }
}
