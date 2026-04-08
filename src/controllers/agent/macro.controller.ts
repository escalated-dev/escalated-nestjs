import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  ParseIntPipe,
  HttpCode,
} from '@nestjs/common';
import { MacroService } from '../../services/macro.service';
import { CannedResponseService } from '../../services/canned-response.service';

@Controller('escalated/agent')
export class AgentMacroController {
  constructor(
    private readonly macroService: MacroService,
    private readonly cannedResponseService: CannedResponseService,
  ) {}

  // Macros
  @Get('macros')
  async listMacros(@Req() req: any) {
    const userId = req.user?.id || req.apiUserId;
    return this.macroService.findAll(userId);
  }

  @Post('macros/:macroId/execute/:ticketId')
  async executeMacro(
    @Param('macroId', ParseIntPipe) macroId: number,
    @Param('ticketId', ParseIntPipe) ticketId: number,
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.macroService.execute(macroId, ticketId, userId);
  }

  // Canned Responses
  @Get('canned-responses')
  async listCannedResponses(@Req() req: any) {
    const userId = req.user?.id || req.apiUserId;
    return this.cannedResponseService.findAll(userId);
  }

  @Get('canned-responses/:id')
  async getCannedResponse(@Param('id', ParseIntPipe) id: number) {
    return this.cannedResponseService.findById(id);
  }
}
