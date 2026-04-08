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
} from '@nestjs/common';
import { ApiTokenService } from '../../services/api-token.service';

@Controller('escalated/admin/api-tokens')
export class AdminApiTokenController {
  constructor(private readonly apiTokenService: ApiTokenService) {}

  @Get()
  async list(@Req() req: any) {
    const userId = req.user?.id || req.apiUserId;
    return this.apiTokenService.findAll(userId);
  }

  @Post()
  async create(
    @Body() body: { name: string; abilities?: string[]; expiresAt?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id || req.apiUserId || 1;
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
  async destroy(@Param('id', ParseIntPipe) id: number) {
    await this.apiTokenService.delete(id);
  }
}
