import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { NewsletterTemplate } from '../../entities/newsletter';
import { NewsletterPermissionService } from '../../services/newsletter/newsletter-permission.service';
import {
  assertArrayOrNull,
  discoverNewsletterThemes,
  inertia,
  optionalString,
  redirect,
  requiredString,
  userIdFromRequest,
} from './newsletter-http.utils';

@Controller('admin/newsletters/templates')
export class AdminNewsletterTemplateController {
  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
    private readonly permissions: NewsletterPermissionService,
    @InjectRepository(NewsletterTemplate)
    private readonly templates: Repository<NewsletterTemplate>,
  ) {}

  @Get()
  async index(@Req() req: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const templates = await this.templates.find({ order: { created_at: 'DESC' } });
    return inertia('Escalated/Admin/Newsletters/Templates/Index', { templates });
  }

  @Get('new')
  async create(@Req() req: any) {
    await this.permissions.require(req, 'newsletters.manage');
    return inertia('Escalated/Admin/Newsletters/Templates/Create', { themes: this.themes() });
  }

  @Post()
  async store(@Req() req: any, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    await this.templates.save(
      this.templates.create({ ...this.validateForm(body), created_by: userIdFromRequest(req) }),
    );
    return redirect('/admin/newsletters/templates');
  }

  @Get(':template')
  async show(@Req() req: any, @Param('template', ParseIntPipe) templateId: number) {
    await this.permissions.require(req, 'newsletters.manage');
    return inertia('Escalated/Admin/Newsletters/Templates/Show', {
      template: await this.findTemplate(templateId),
      themes: this.themes(),
      isNew: false,
    });
  }

  @Put(':template')
  async update(
    @Req() req: any,
    @Param('template', ParseIntPipe) templateId: number,
    @Body() body: any,
  ) {
    await this.permissions.require(req, 'newsletters.manage');
    await this.templates.update((await this.findTemplate(templateId)).id, this.validateForm(body));
    return redirect(`/admin/newsletters/templates/${templateId}`);
  }

  @Delete(':template')
  async destroy(@Req() req: any, @Param('template', ParseIntPipe) templateId: number) {
    await this.permissions.require(req, 'newsletters.manage');
    await this.templates.delete((await this.findTemplate(templateId)).id);
    return redirect('/admin/newsletters/templates');
  }

  private validateForm(body: any) {
    return {
      name: requiredString(body, 'name', 255),
      theme: requiredString(body, 'theme', 64),
      subject_template: optionalString(body, 'subject_template', 998),
      body_markdown: requiredString(body, 'body_markdown'),
      merge_fields_schema: assertArrayOrNull(body?.merge_fields_schema, 'merge_fields_schema'),
    };
  }

  private themes(): string[] {
    return discoverNewsletterThemes(this.options.newsletters?.themesDir);
  }

  private async findTemplate(id: number): Promise<NewsletterTemplate> {
    const template = await this.templates.findOne({ where: { id } });
    if (!template) throw new BadRequestException(`Newsletter template #${id} not found`);
    return template;
  }
}
