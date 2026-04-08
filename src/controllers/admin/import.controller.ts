import { Controller, Post, Body, Req } from '@nestjs/common';
import { ImportService } from '../../services/import.service';

@Controller('escalated/admin/import')
export class AdminImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('tickets')
  async importTickets(@Body('data') data: any[], @Req() req: any) {
    const userId = req.user?.id || req.apiUserId || 1;
    return this.importService.importTickets(data, userId);
  }

  @Post('tags')
  async importTags(@Body('data') data: any[]) {
    return this.importService.importTags(data);
  }

  @Post('departments')
  async importDepartments(@Body('data') data: any[]) {
    return this.importService.importDepartments(data);
  }
}
