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
import { AgentService } from '../../services/agent.service';
import { SkillService } from '../../services/skill.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

@Controller('escalated/admin/agents')
@UseInterceptors(AuditLogInterceptor)
export class AdminAgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly skillService: SkillService,
  ) {}

  @Get()
  async list() {
    return this.agentService.findAll();
  }

  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number) {
    const profile = await this.agentService.findById(id);
    const capacity = await this.agentService.getCapacity(id);
    return { profile, capacity };
  }

  @Post()
  @AuditAction('create', 'agent')
  async create(@Body() body: any) {
    return this.agentService.create(body);
  }

  @Put(':id')
  @AuditAction('update', 'agent')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.agentService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'agent')
  async destroy(@Param('id', ParseIntPipe) id: number) {
    await this.agentService.delete(id);
  }

  @Put(':id/skills')
  async setSkills(
    @Param('id', ParseIntPipe) id: number,
    @Body('skillIds') skillIds: number[],
  ) {
    return this.agentService.setSkills(id, skillIds);
  }

  @Put(':id/capacity')
  async updateCapacity(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { maxTickets?: number; maxUrgent?: number },
  ) {
    return this.agentService.updateCapacity(id, body);
  }

  @Post(':id/recalculate-capacity')
  async recalculateCapacity(@Param('id', ParseIntPipe) id: number) {
    return this.agentService.recalculateCapacity(id);
  }

  // Skills management
  @Get('/skills/all')
  async listSkills() {
    return this.skillService.findAll();
  }

  @Post('/skills/create')
  @AuditAction('create', 'skill')
  async createSkill(@Body() body: any) {
    return this.skillService.create(body);
  }

  @Delete('/skills/:id')
  @HttpCode(204)
  async deleteSkill(@Param('id', ParseIntPipe) id: number) {
    await this.skillService.delete(id);
  }
}
