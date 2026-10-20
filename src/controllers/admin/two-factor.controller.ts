import { Controller, Post, Delete, Body, Req, UseGuards } from '@nestjs/common';
import { TwoFactorService } from '../../services/two-factor.service';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { requireUserId } from '../../config/request-user';

@UseGuards(EscalatedAdminGuard)
@Controller('escalated/admin/2fa')
export class AdminTwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('generate')
  async generate(@Req() req: any) {
    const userId = requireUserId(req);
    return this.twoFactorService.generateSecret(userId);
  }

  @Post('enable')
  async enable(@Body('token') token: string, @Req() req: any) {
    const userId = requireUserId(req);
    return this.twoFactorService.enable(userId, token);
  }

  @Post('verify')
  async verify(@Body('token') token: string, @Req() req: any) {
    const userId = requireUserId(req);
    const valid = await this.twoFactorService.verify(userId, token);
    return { valid };
  }

  @Delete('disable')
  async disable(@Req() req: any) {
    const userId = requireUserId(req);
    await this.twoFactorService.disable(userId);
    return { success: true };
  }
}
