import { Controller, Post, Delete, Body, Req } from '@nestjs/common';
import { TwoFactorService } from '../../services/two-factor.service';

@Controller('escalated/admin/2fa')
export class AdminTwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('generate')
  async generate(@Req() req: any) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.twoFactorService.generateSecret(userId);
  }

  @Post('enable')
  async enable(@Body('token') token: string, @Req() req: any) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.twoFactorService.enable(userId, token);
  }

  @Post('verify')
  async verify(@Body('token') token: string, @Req() req: any) {
    const userId = req.user?.id || req.apiUserId || 1;
    const valid = await this.twoFactorService.verify(userId, token);
    return { valid };
  }

  @Delete('disable')
  async disable(@Req() req: any) {
    const userId = req.user?.id || req.apiUserId || 1;
    await this.twoFactorService.disable(userId);
    return { success: true };
  }
}
