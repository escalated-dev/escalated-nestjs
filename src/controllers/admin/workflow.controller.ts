import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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

/**
 * Workflow admin as a JSON API, on the wire contract of the shared builder
 * (escalated-developer-context `domain-model/workflow-admin-contract.md`).
 * See docs/workflows.md.
 */
@UseGuards(EscalatedAdminGuard)
@Controller('escalated/admin/workflows')
@UseInterceptors(AuditLogInterceptor)
export class AdminWorkflowController {
  constructor(private readonly workflows: WorkflowAdminService) {}

  @Get()
  async index() {
    return { workflows: await this.workflows.list() };
  }

  /** `trigger_events`, `action_types` and `operators` for the builder form. */
  @Get('options')
  options() {
    return this.workflows.options();
  }

  /** Logs across every workflow; `?workflow_id=` narrows them to one. */
  @Get('logs')
  async allLogs(@Query('workflow_id') workflowId?: string) {
    const id = workflowId ? Number(workflowId) : undefined;
    return { logs: await this.workflows.logs(Number.isInteger(id) ? id : undefined) };
  }

  @Post()
  @AuditAction('create', 'workflow')
  async store(@Body() body: unknown) {
    return this.workflows.create(body);
  }

  @Post('reorder')
  @HttpCode(200)
  @AuditAction('reorder', 'workflow')
  async reorder(@Body() body: unknown) {
    return { workflows: await this.workflows.reorder(body) };
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number) {
    return this.workflows.show(id);
  }

  @Put(':id')
  @AuditAction('update', 'workflow')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.workflows.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'workflow')
  async destroy(@Param('id', ParseIntPipe) id: number) {
    await this.workflows.delete(id);
  }

  @Post(':id/toggle')
  @HttpCode(200)
  @AuditAction('toggle', 'workflow')
  async toggle(@Param('id', ParseIntPipe) id: number) {
    return this.workflows.toggle(id);
  }

  @Get(':id/logs')
  async logs(@Param('id', ParseIntPipe) id: number) {
    return { logs: await this.workflows.logs(id) };
  }
}
