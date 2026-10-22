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
  UseGuards,
  Inject,
  NotFoundException,
  Optional,
  Req,
} from '@nestjs/common';
import { SkillService } from '../../services/skill.service';
import { CreateSkillDto } from '../../dto/admin/create-skill.dto';
import { UpdateSkillDto } from '../../dto/admin/update-skill.dto';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { skillInput } from '../../ui/admin-operations';
import { inertia, redirect } from '../../ui/inertia';
import { BrowserFormGuard, EscalatedUi } from '../../ui/inertia.interceptor';
import { wantsPage } from '../../ui/request';
import { routeUrl } from '../../ui/routes';
import { iso } from '../../ui/serializers';
import { UiDataService } from '../../ui/ui-data.service';

/**
 * Skills as a JSON API (camelCase DTOs). With `ui.enabled`, the same routes
 * also serve `Escalated/Admin/Skills/Index` and `Form` (plus `create`), with
 * escalated-laravel's Admin\SkillController props and snake_case form fields,
 * answering the form with redirects. API clients keep the JSON.
 */
@UseGuards(EscalatedAdminGuard, BrowserFormGuard)
@Controller('escalated/admin/skills')
@UseInterceptors(AuditLogInterceptor)
@EscalatedUi()
export class AdminSkillController {
  constructor(
    private readonly skillService: SkillService,
    @Optional() private readonly ui?: UiDataService,
    @Optional() @Inject(ESCALATED_OPTIONS) private readonly options?: EscalatedModuleOptions,
  ) {}

  private screen(req: any): boolean {
    return !!this.ui && wantsPage(this.options, req);
  }

  private toIndex(message: string) {
    return redirect(routeUrl('escalated.admin.skills.index'), { success: message });
  }

  /** `availableAgents`, `availableTags` and `availableDepartments`, as Laravel's formPayload(). */
  private async formPayload() {
    const refs = await this.skillService.screenReferences();
    const directory = await this.ui!.directory(refs.agents.map((agent) => agent.userId));
    return {
      availableAgents: refs.agents.map((agent) => {
        const user = directory.get(String(agent.userId));
        return {
          id: agent.userId,
          name: agent.name || user?.name || `Agent #${agent.userId}`,
          email: user?.email ?? null,
        };
      }),
      availableTags: refs.tags,
      availableDepartments: refs.departments,
    };
  }

  /** The form's snake_case fields, checked against what exists. */
  private async screenInput(body: any, exceptId?: number) {
    const refs = await this.skillService.screenReferences();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    return skillInput(body, {
      nameTaken: !!name && (await this.skillService.nameTaken(name, exceptId)),
      tagIds: new Set(refs.tags.map((tag) => tag.id)),
      departmentIds: new Set(refs.departments.map((department) => department.id)),
      agentIds: new Set(refs.agents.map((agent) => String(agent.userId))),
    });
  }

  @Get()
  async list(@Req() req?: any): Promise<any> {
    const skills = await this.skillService.listForAdmin();
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Skills/Index', {
        skills: skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          slug: skill.slug,
          agents_count: skill.agentsCount,
          routing_tags_count: skill.routingTagsCount,
          routing_departments_count: skill.routingDepartmentsCount,
          updated_at: iso(skill.updatedAt),
        })),
      });
    }
    return { skills };
  }

  /** The new-skill screen (`ui.enabled` only). */
  @Get('create')
  async createForm(@Req() req?: any) {
    if (!this.screen(req)) throw new NotFoundException();
    return inertia('Escalated/Admin/Skills/Form', { skill: null, ...(await this.formPayload()) });
  }

  @Get('new')
  async newForm() {
    return this.skillService.getFormContext();
  }

  @Post()
  @AuditAction('create', 'skill')
  async create(@Body() dto: CreateSkillDto, @Req() req?: any): Promise<any> {
    if (this.screen(req)) {
      // The raw body: the form's fields are snake_case, not the DTO's.
      const input = await this.screenInput(req.body);
      await this.skillService.create({
        ...input,
        slug: await this.skillService.uniqueSlug(input.name),
      });
      return this.toIndex('Skill created.');
    }
    return this.skillService.create(dto);
  }

  @Get(':id/edit')
  async edit(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    const [skill, context] = await Promise.all([
      this.skillService.findForEdit(id),
      this.screen(req) ? this.formPayload() : this.skillService.getFormContext(),
    ]);
    if (this.screen(req)) {
      return inertia('Escalated/Admin/Skills/Form', {
        ...context,
        skill: {
          id: skill.id,
          name: skill.name,
          slug: skill.slug,
          routing_tag_ids: skill.routingTagIds,
          routing_department_ids: skill.routingDepartmentIds,
          agents: skill.agents.map((agent) => ({
            user_id: agent.userId,
            proficiency: Number(agent.proficiency ?? 1),
          })),
        },
      });
    }
    return { skill, ...context };
  }

  @Put(':id')
  @AuditAction('update', 'skill')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSkillDto,
    @Req() req?: any,
  ): Promise<any> {
    if (this.screen(req)) {
      await this.skillService.findById(id);
      await this.skillService.update(id, await this.screenInput(req.body, id));
      return this.toIndex('Skill updated.');
    }
    return this.skillService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @AuditAction('delete', 'skill')
  async destroy(@Param('id', ParseIntPipe) id: number, @Req() req?: any): Promise<any> {
    await this.skillService.delete(id);
    if (this.screen(req)) return this.toIndex('Skill deleted.');
  }
}
