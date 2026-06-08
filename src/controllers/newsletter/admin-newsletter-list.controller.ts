import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync } from 'fs';
import { Repository } from 'typeorm';
import { Contact } from '../../entities/contact.entity';
import { NewsletterList, NewsletterListMember } from '../../entities/newsletter';
import { ContactSegmentResolverService } from '../../services/newsletter/contact-segment-resolver.service';
import { NewsletterPermissionService } from '../../services/newsletter/newsletter-permission.service';
import {
  abort422,
  assertArrayOrNull,
  assertOneOf,
  inertia,
  optionalString,
  redirect,
  requiredInteger,
  requiredString,
  userIdFromRequest,
} from './newsletter-http.utils';

@Controller('admin/newsletters/lists')
export class AdminNewsletterListController {
  constructor(
    private readonly permissions: NewsletterPermissionService,
    private readonly segments: ContactSegmentResolverService,
    @InjectRepository(NewsletterList)
    private readonly lists: Repository<NewsletterList>,
    @InjectRepository(NewsletterListMember)
    private readonly members: Repository<NewsletterListMember>,
    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,
  ) {}

  @Get()
  async index(@Req() req: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const lists = await this.lists.find();
    return inertia('Escalated/Admin/Newsletters/Lists/Index', {
      lists: await Promise.all(lists.map((list) => this.withCounts(list))),
    });
  }

  @Get('new')
  async create(@Req() req: any) {
    await this.permissions.require(req, 'newsletters.manage');
    return inertia('Escalated/Admin/Newsletters/Lists/Create', {});
  }

  @Post()
  async store(@Req() req: any, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const list = await this.lists.save(
      this.lists.create({
        name: requiredString(body, 'name', 255),
        description: optionalString(body, 'description'),
        kind: assertOneOf(body?.kind, 'kind', ['static', 'dynamic']),
        filter_json: assertArrayOrNull(body?.filter_json, 'filter_json') as any,
        created_by: userIdFromRequest(req),
      }),
    );
    return redirect(`/admin/newsletters/lists/${list.id}`);
  }

  @Get(':list')
  async show(@Req() req: any, @Param('list', ParseIntPipe) listId: number) {
    await this.permissions.require(req, 'newsletters.manage');
    const list = await this.findList(listId);
    const members = await this.members.find({
      where: { list_id: list.id },
      relations: { contact: true },
      order: { id: 'DESC' },
      take: 100,
    });
    return inertia('Escalated/Admin/Newsletters/Lists/Show', {
      list: await this.withCounts(list),
      members,
      matchCount:
        list.kind === 'dynamic'
          ? await this.segments.countMatches(list.filter_json ?? { rules: [] })
          : 0,
    });
  }

  @Put(':list')
  async update(@Req() req: any, @Param('list', ParseIntPipe) listId: number, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const list = await this.findList(listId);
    await this.lists.update(list.id, {
      ...(body.name !== undefined ? { name: requiredString(body, 'name', 255) } : {}),
      ...(body.description !== undefined
        ? { description: optionalString(body, 'description') }
        : {}),
      ...(body.filter_json !== undefined
        ? { filter_json: assertArrayOrNull(body.filter_json, 'filter_json') as any }
        : {}),
    });
    return redirect(`/admin/newsletters/lists/${list.id}`);
  }

  @Delete(':list')
  async destroy(@Req() req: any, @Param('list', ParseIntPipe) listId: number) {
    await this.permissions.require(req, 'newsletters.manage');
    await this.lists.delete((await this.findList(listId)).id);
    return redirect('/admin/newsletters/lists');
  }

  @Post(':list/members')
  async addMember(@Req() req: any, @Param('list', ParseIntPipe) listId: number, @Body() body: any) {
    await this.permissions.require(req, 'newsletters.manage');
    const list = await this.findList(listId);
    this.assertStatic(list);
    const contactId = requiredInteger(body, 'contact_id');
    if ((await this.contacts.count({ where: { id: contactId } })) === 0) {
      throw new BadRequestException('contact_id does not exist');
    }
    const existing = await this.members.findOne({
      where: { list_id: list.id, contact_id: contactId },
    });
    if (!existing) {
      await this.members.save(
        this.members.create({
          list_id: list.id,
          contact_id: contactId,
          added_by: userIdFromRequest(req),
        }),
      );
    }
    return redirect(`/admin/newsletters/lists/${list.id}`);
  }

  @Delete(':list/members/:contactId')
  async removeMember(
    @Req() req: any,
    @Param('list', ParseIntPipe) listId: number,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    await this.permissions.require(req, 'newsletters.manage');
    const list = await this.findList(listId);
    this.assertStatic(list);
    await this.members.delete({ list_id: list.id, contact_id: contactId });
    return redirect(`/admin/newsletters/lists/${list.id}`);
  }

  @Post(':list/import')
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(
    @Req() req: any,
    @Param('list', ParseIntPipe) listId: number,
    @UploadedFile() file: any,
  ) {
    await this.permissions.require(req, 'newsletters.manage');
    const list = await this.findList(listId);
    this.assertStatic(list);
    if (!file) throw new BadRequestException('file is required');

    const text = Buffer.isBuffer(file.buffer)
      ? file.buffer.toString('utf8')
      : file.path
        ? readFileSync(file.path, 'utf8')
        : '';
    let imported = 0;
    for (const line of text.split(/\r?\n/)) {
      const email = line.split(',')[0]?.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      let contact = await this.contacts.findOne({ where: { email } });
      if (!contact) {
        contact = await this.contacts.save(this.contacts.create({ email, name: null }));
      }
      const exists = await this.members.findOne({
        where: { list_id: list.id, contact_id: contact.id },
      });
      if (!exists) {
        await this.members.save(
          this.members.create({
            list_id: list.id,
            contact_id: contact.id,
            added_by: userIdFromRequest(req),
          }),
        );
      }
      imported++;
    }

    return redirect(`/admin/newsletters/lists/${list.id}`, {
      status: `Imported ${imported} contacts`,
    });
  }

  private async findList(id: number): Promise<NewsletterList> {
    const list = await this.lists.findOne({ where: { id } });
    if (!list) throw new BadRequestException(`Newsletter list #${id} not found`);
    return list;
  }

  private assertStatic(list: NewsletterList): void {
    if (list.kind !== 'static') abort422('Dynamic lists are filter-driven');
  }

  private async withCounts(list: NewsletterList) {
    const memberCount = await this.members.count({ where: { list_id: list.id } });
    const optedOut = await this.members
      .createQueryBuilder('member')
      .innerJoin(Contact, 'contact', 'contact.id = member.contact_id')
      .where('member.list_id = :id', { id: list.id })
      .andWhere('contact.marketing_opt_out_at IS NOT NULL')
      .getCount();
    return { ...list, member_count: memberCount, opted_out_count: optedOut };
  }
}
