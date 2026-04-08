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
import { SavedViewService } from '../../services/saved-view.service';

@Controller('escalated/agent/saved-views')
export class AgentSavedViewController {
  constructor(private readonly savedViewService: SavedViewService) {}

  @Get()
  async list(@Req() req: any) {
    const userId = req.user?.id || req.apiUserId;
    return this.savedViewService.findAll(userId);
  }

  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const userId = req.user?.id || req.apiUserId;
    return this.savedViewService.create({ ...body, userId });
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.savedViewService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.savedViewService.delete(id);
  }

  @Post(':id/default')
  async setDefault(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const userId = req.user?.id || req.apiUserId;
    return this.savedViewService.setDefault(id, userId);
  }
}
