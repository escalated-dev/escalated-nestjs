import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Req,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { WorkflowAdminService } from '../../services/workflow-admin.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { inertia, redirect } from '../../ui/inertia';
import { EscalatedUi, BrowserFormGuard } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { uiEnabled } from '../../ui/ui-options';

/**
 * Workflow admin as a JSON API, on the wire contract of the shared builder
 * (escalated-developer-context `domain-model/workflow-admin-contract.md`).
 * See docs/workflows.md.
 */
/**
 * With `ui.enabled`, also the Workflows screens (`Admin/Workflows/Index` and
 * `Form`), answering their forms with redirects to the list.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin/workflows')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminWorkflowController {
  constructor(
    private readonly workflows: WorkflowAdminService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly moduleOptions?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return wantsPage(this.moduleOptions, req);
  }

  private toIndex(message: string) {
    return redirect(routeUrl('escalated.admin.workflows.index'), { success: message });
  }

  /** `Escalated/Admin/Workflows/Form`, as escalated-laravel's WorkflowController@create / @edit. */
  private form(workflow: unknown) {
    const { trigger_events, action_types, operators } = this.workflows.options();
    return inertia('Escalated/Admin/Workflows/Form', {
      workflow,
      trigger_events,
      action_types,
      operators,
    });
  }

  @Get()
  async index(@Req() req?: any): Promise<any> {
    const workflows = await this.workflows.list();
    if (this.screen(req)) return inertia('Escalated/Admin/Workflows/Index', { workflows });
    return { workflows };
  }

  /** The new-workflow screen (`ui.enabled` only). Declared before `:id`. */
  @Get('create')
  create() {
    if (!uiEnabled(this.moduleOptions)) throw new NotFoundException();
    return this.form(null);
  }

  /** `trigger_events`, `action_types` and `operators` for the builder form. */
  @Get('options')
  options() {
    return this.workflows.options();
  }

  /**
   * Logs across every workflow; `?workflow_id=` (or the screen's `?workflow=`)
   * narrows them to one. With `ui.enabled`, also `Escalated/Admin/Workflows/Logs`
   * with the workflows to filter by, as escalated-laravel's WorkflowController@logs.
   */
  @Get('logs')
  async allLogs(
    @Query('workflow_id') workflowId?: string,
    @Query('workflow') workflow?: string,
    @Req() req?: any,
  ): Promise<any> {
    const raw = workflowId || workflow;
    const id = raw ? Number(raw) : undefined;
    const logs = await this.workflows.logs(Number.isInteger(id) ? id : undefined);
    if (this.screen(req)) {
      const workflows = (await this.workflows.list()).map((w) => ({ id: w.id, name: w.name }));
      return inertia('Escalated/Admin/Workflows/Logs', { logs, workflows });
    }
    return { logs };
  }

  @Post()
  @AuditAction('create', 'workflow')
  async store(@Body() body: unknown, @Req() req?: any): Promise<any> {
    const workflow = await this.workflows.create(body);
    return this.screen(req) ? this.toIndex('Workflow created.') : workflow;
  }

  @Post('reorder')
  @HttpCode(200)
  @AuditAction('reorder', 'workflow')
  async reorder(@Body() body: unknown, @Req() req?: any): Promise<any> {
    const workflows = await this.workflows.reorder(body);
    return this.screen(req) ? this.toIndex('Workflows reordered.') : { workflows };
  }

  /** The edit screen (`ui.enabled` only). */
  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number) {
    if (!uiEnabled(this.moduleOptions)) throw new NotFoundException();
    return this.form(await this.workflows.show(id));
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number) {
    return this.workflows.show(id);
  }

  @Put(':id')
  @AuditAction('update', 'workflow')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req?: any,
  ): Promise<any> {
    const workflow = await this.workflows.update(id, body);
    return this.screen(req) ? this.toIndex('Workflow updated.') : workflow;
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'workflow')
  async destroy(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.workflows.delete(id);
    if (this.screen(req)) return this.toIndex('Workflow deleted.');
  }

  @Post(':id/toggle')
  @HttpCode(200)
  @AuditAction('toggle', 'workflow')
  async toggle(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    const workflow = await this.workflows.toggle(id);
    return this.screen(req)
      ? this.toIndex(`Workflow ${workflow.is_active ? 'enabled' : 'disabled'}.`)
      : workflow;
  }

  @Get(':id/logs')
  async logs(@Param('id', ParseIntPipe) id: number) {
    return { logs: await this.workflows.logs(id) };
  }
}
