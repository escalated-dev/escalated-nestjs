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
import { MacroService } from '../../services/macro.service';
import { CannedResponseService } from '../../services/canned-response.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

@Controller('escalated/admin')
@UseInterceptors(AuditLogInterceptor)
export class AdminMacroController {
  constructor(
    private readonly macroService: MacroService,
    private readonly cannedResponseService: CannedResponseService,
  ) {}

  // Macros
  @Get('macros')
  async listMacros() {
    return this.macroService.findAll();
  }

  @Get('macros/:id')
  async showMacro(@Param('id', ParseIntPipe) id: number) {
    return this.macroService.findById(id);
  }

  @Post('macros')
  @AuditAction('create', 'macro')
  async createMacro(@Body() body: any) {
    return this.macroService.create(body);
  }

  @Put('macros/:id')
  @AuditAction('update', 'macro')
  async updateMacro(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.macroService.update(id, body);
  }

  @Delete('macros/:id')
  @HttpCode(204)
  async deleteMacro(@Param('id', ParseIntPipe) id: number) {
    await this.macroService.delete(id);
  }

  // Canned Responses
  @Get('canned-responses')
  async listCannedResponses() {
    return this.cannedResponseService.findAll();
  }

  @Post('canned-responses')
  @AuditAction('create', 'canned_response')
  async createCannedResponse(@Body() body: any) {
    return this.cannedResponseService.create(body);
  }

  @Put('canned-responses/:id')
  @AuditAction('update', 'canned_response')
  async updateCannedResponse(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.cannedResponseService.update(id, body);
  }

  @Delete('canned-responses/:id')
  @HttpCode(204)
  async deleteCannedResponse(@Param('id', ParseIntPipe) id: number) {
    await this.cannedResponseService.delete(id);
  }
}
