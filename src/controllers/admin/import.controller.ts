import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ImportService } from '../../services/import.service';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { requireUserId } from '../../config/request-user';

@UseGuards(EscalatedAdminGuard)
@Controller('escalated/admin/import')
export class AdminImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('tickets')
  async importTickets(@Body('data') data: any[], @Req() req: any) {
    const userId = requireUserId(req);
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
