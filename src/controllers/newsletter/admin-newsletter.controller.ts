import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { Contact } from '../../entities/contact.entity';
import {
  Newsletter,
  NewsletterDelivery,
  NewsletterList,
  NewsletterStatus,
  NewsletterTemplate,
} from '../../entities/newsletter';
import { NewsletterPermissionService } from '../../services/newsletter/newsletter-permission.service';
import { NewsletterPlannerService } from '../../services/newsletter/newsletter-planner.service';
import { NewsletterRendererService } from '../../services/newsletter/newsletter-renderer.service';
import {
  abort422,
  assertEmail,
  assertOneOf,
  discoverNewsletterThemes,
  inertia,
  optionalDateAfterNow,
  optionalInteger,
  optionalString,
  redirect,
  requiredInteger,
  requiredString,
  userIdFromRequest,
} from './newsletter-http.utils';

interface NewsletterForm {
  subject: string;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
  target_list_id: number;
  template_id: number | null;
  theme: string | null;
  body_markdown: string | null;
  status: NewsletterStatus;
  scheduled_at: Date | null;
}

@Controller('admin/newsletters')
export class AdminNewsletterController {
  constructor(
    @Inject(ESCALATED_OPTIONS)
    private readonly options: EscalatedModuleOptions,
    private readonly permissions: NewsletterPermissionService,
    private readonly planner: NewsletterPlannerService,
    private readonly renderer: NewsletterRendererService,
    @InjectRepository(Newsletter)
    private readonly newsletters: Repository<Newsletter>,
    @InjectRepository(NewsletterList)
    private readonly lists: Repository<NewsletterList>,
    @InjectRepository(NewsletterTemplate)
    private readonly templates: Repository<NewsletterTemplate>,
    @InjectRepository(NewsletterDelivery)
    private readonly deliveries: Repository<NewsletterDelivery>,
    @Optional() private readonly mailer?: MailerService,
  ) {}

  @Get()
  async index(@Req() req: any, @Query('tab') tab = 'drafts') {
    await this.permissions.require(req, 'newsletters.manage');
    const statuses =
      tab === 'scheduled'
        ? ['scheduled', 'sending', 'paused']
        : tab === 'sent'
          ? ['sent', 'failed']
          : ['draft'];
    const newsletters = await this.newsletters.find({
      where: { status: In(statuses as NewsletterStatus[]) },
      relations: ['targetList'],
      order: { created_at: 'DESC' },
      take: 50,
    });
    return inertia('Escalated/Admin/Newsletters/Index', { newsletters, tab });
  }

  @Get('new')
  async create(@Req() req: any) {
    await this.permissions.require(req, 'newsletters.manage');
    return inertia('Escalated/Admin/Newsletters/Compose', await this.composeProps());
  }

  @Post()
  async store(@Req() req: any, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const data = await this.validateForm(body);
    if (['scheduled', 'sending'].includes(data.status)) {
      await this.permissions.require(req, 'newsletters.send');
      if (!this.mailConfigured()) {
        throw new BadRequestException({ from_email: 'Outbound mail is not configured.' });
      }
    }

    const newsletter = await this.newsletters.save(
      this.newsletters.create({ ...data, created_by: userIdFromRequest(req), sent_by: null }),
    );
    if (data.status === 'sending') {
      await this.planner.plan(newsletter);
    }
    return redirect(`/admin/newsletters/${newsletter.id}`);
  }

  @Post('preview')
  async preview(@Req() req: any, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const fromEmail = assertEmail(optionalString(body, 'from_email'), 'from_email') ?? 'preview@example.test';
    const newsletter = this.newsletters.create({
      id: 0,
      subject: optionalString(body, 'subject', 998) ?? '',
      from_email: fromEmail,
      from_name: null,
      reply_to: null,
      target_list_id: optionalInteger(body, 'target_list_id') ?? 0,
      template_id: null,
      theme: optionalString(body, 'theme', 64) ?? 'default',
      body_markdown: optionalString(body, 'body_markdown'),
      status: 'draft',
      scheduled_at: null,
      sent_at: null,
      created_by: null,
      sent_by: null,
    });
    const contact = this.previewContact();
    const delivery = this.previewDelivery(newsletter, contact, 'preview');
    return { html: this.renderer.render(delivery) };
  }

  @Post('test')
  async testSend(@Req() req: any, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.send');
    const data = await this.validateForm(body);
    if (!this.mailer) {
      throw new BadRequestException({ from_email: 'Outbound mail is not configured.' });
    }
    const user = req.user ?? {};
    const contact = new Contact();
    contact.id = Number(user.id ?? 0);
    contact.email = user.email ?? data.from_email;
    contact.name = user.name ?? 'Tester';
    contact.metadata = {};
    contact.marketing_opt_out_at = null;

    const newsletter = this.newsletters.create({ id: 0, ...data, created_by: null, sent_by: null });
    const delivery = this.previewDelivery(newsletter, contact, randomBytes(20).toString('hex'));
    delivery.is_test = true;
    const html = this.renderer.render(delivery);
    await this.mailer.sendMail({
      to: contact.email,
      from: data.from_name ? `"${data.from_name}" <${data.from_email}>` : data.from_email,
      subject: `[TEST] ${data.subject}`,
      html,
    });
    return { ok: true };
  }

  @Get(':newsletter')
  async show(
    @Req() req: any,
    @Param('newsletter', ParseIntPipe) newsletterId: number,
    @Query('tab') tab = 'overview',
    @Query('status') status?: string,
  ) {
    await this.permissions.require(req, 'newsletters.manage');
    const newsletter = await this.findNewsletter(newsletterId);
    const where: any = { newsletter_id: newsletter.id, is_test: false };
    if (status) where.status = status;
    const deliveries = await this.deliveries.find({
      where,
      relations: ['contact'],
      order: { id: 'DESC' as const },
      take: 100,
    });
    return inertia('Escalated/Admin/Newsletters/Show', {
      newsletter,
      deliveries,
      topClicks: [],
      tab,
    });
  }

  @Get(':newsletter/edit')
  async edit(@Req() req: any, @Param('newsletter', ParseIntPipe) newsletterId: number) {
    await this.permissions.require(req, 'newsletters.manage');
    const newsletter = await this.findNewsletter(newsletterId);
    if (!['draft', 'scheduled'].includes(newsletter.status)) {
      abort422('Only drafts and scheduled newsletters can be edited');
    }
    return inertia('Escalated/Admin/Newsletters/Edit', {
      ...(await this.composeProps()),
      newsletter,
    });
  }

  @Put(':newsletter')
  async update(@Req() req: any, @Param('newsletter', ParseIntPipe) newsletterId: number, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const newsletter = await this.findNewsletter(newsletterId);
    const data = await this.validateForm(body);
    if (['scheduled', 'sending'].includes(data.status)) {
      await this.permissions.require(req, 'newsletters.send');
    }
    await this.newsletters.update(newsletter.id, data);
    if (data.status === 'sending') {
      await this.planner.plan({ ...newsletter, ...data });
    }
    return redirect(`/admin/newsletters/${newsletter.id}`);
  }

  @Delete(':newsletter')
  async destroy(@Req() req: any, @Param('newsletter', ParseIntPipe) newsletterId: number) {
    await this.permissions.require(req, 'newsletters.manage');
    const newsletter = await this.findNewsletter(newsletterId);
    if (newsletter.status !== 'draft') {
      abort422('Only drafts can be deleted');
    }
    await this.newsletters.delete(newsletter.id);
    return redirect('/admin/newsletters');
  }

  private async composeProps(): Promise<Record<string, unknown>> {
    const lists = await this.lists.find({ select: ['id', 'name'] });
    const listProps = await Promise.all(
      lists.map(async (list) => ({
        ...list,
        member_count: await this.deliveries.manager.count('escalated_newsletter_list_members', {
          where: { list_id: list.id },
        }),
      })),
    );
    return {
      lists: listProps,
      templates: await this.templates.find({ select: ['id', 'name'] }),
      themes: discoverNewsletterThemes(this.options.newsletters?.themesDir),
      mailConfigured: this.mailConfigured(),
      canSend: true,
      defaultFromEmail: this.options.newsletters?.defaultFrom ?? null,
      defaultReplyTo: this.options.newsletters?.defaultReplyTo ?? null,
      defaultTheme: this.options.newsletters?.defaultTheme ?? 'default',
    };
  }

  private async validateForm(body: any): Promise<NewsletterForm> {
    const targetListId = requiredInteger(body, 'target_list_id');
    if ((await this.lists.count({ where: { id: targetListId } })) === 0) {
      throw new BadRequestException('target_list_id does not exist');
    }
    const templateId = optionalInteger(body, 'template_id');
    if (templateId && (await this.templates.count({ where: { id: templateId } })) === 0) {
      throw new BadRequestException('template_id does not exist');
    }
    return {
      subject: requiredString(body, 'subject', 998),
      from_email: assertEmail(requiredString(body, 'from_email', 320), 'from_email', true)!,
      from_name: optionalString(body, 'from_name', 255),
      reply_to: assertEmail(optionalString(body, 'reply_to', 320), 'reply_to'),
      target_list_id: targetListId,
      template_id: templateId,
      theme: optionalString(body, 'theme', 64),
      body_markdown: optionalString(body, 'body_markdown'),
      status: assertOneOf(body?.status ?? 'draft', 'status', ['draft', 'scheduled', 'sending']),
      scheduled_at: optionalDateAfterNow(body, 'scheduled_at'),
    };
  }

  private async findNewsletter(id: number): Promise<Newsletter> {
    const newsletter = await this.newsletters.findOne({
      where: { id },
      relations: ['targetList', 'template'],
    });
    if (!newsletter) {
      throw new BadRequestException(`Newsletter #${id} not found`);
    }
    return newsletter;
  }

  private mailConfigured(): boolean {
    return !!this.options.mail && !!this.mailer;
  }

  private previewContact(): Contact {
    const contact = new Contact();
    contact.id = 0;
    contact.email = 'preview@example.test';
    contact.name = 'Preview User';
    contact.metadata = {};
    contact.marketing_opt_out_at = null;
    return contact;
  }

  private previewDelivery(newsletter: Newsletter, contact: Contact, token: string): NewsletterDelivery {
    return {
      id: '0',
      newsletter_id: newsletter.id,
      contact_id: contact.id,
      email_at_send: contact.email,
      status: 'pending',
      tracking_token: token,
      sent_at: null,
      opened_at: null,
      last_clicked_at: null,
      clicks_count: 0,
      bounce_reason: null,
      failure_reason: null,
      attempt_count: 0,
      claimed_at: null,
      next_attempt_at: null,
      is_test: false,
      created_at: new Date(),
      newsletter,
      contact,
    };
  }
}
