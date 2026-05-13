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
import { SkillService } from '../../services/skill.service';
import { CreateSkillDto } from '../../dto/admin/create-skill.dto';
import { UpdateSkillDto } from '../../dto/admin/update-skill.dto';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

@Controller('escalated/admin/skills')
@UseInterceptors(AuditLogInterceptor)
export class AdminSkillController {
  constructor(private readonly skillService: SkillService) {}

  @Get()
  async list() {
    return { skills: await this.skillService.listForAdmin() };
  }

  @Get('new')
  async newForm() {
    return this.skillService.getFormContext();
  }

  @Post()
  @AuditAction('create', 'skill')
  async create(@Body() dto: CreateSkillDto) {
    return this.skillService.create(dto);
  }

  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number) {
    const [skill, context] = await Promise.all([
      this.skillService.findForEdit(id),
      this.skillService.getFormContext(),
    ]);
    return { skill, ...context };
  }

  @Put(':id')
  @AuditAction('update', 'skill')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSkillDto) {
    return this.skillService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'skill')
  async destroy(@Param('id', ParseIntPipe) id: number) {
    await this.skillService.delete(id);
  }
}
