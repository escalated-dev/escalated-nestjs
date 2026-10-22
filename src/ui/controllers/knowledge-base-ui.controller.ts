import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { ESCALATED_OPTIONS, type EscalatedModuleOptions } from '../../config/escalated.config';
import { requireUserId } from '../../config/request-user';
import { KbArticle } from '../../entities/kb-article.entity';
import { KbCategory } from '../../entities/kb-category.entity';
import { EscalatedAdminGuard } from '../../guards/escalated-route.guard';
import { KnowledgeBaseService } from '../../services/knowledge-base.service';
import { back, inertia, redirect } from '../inertia';
import { EscalatedUi, ScriptedRequestGuard, UiValidationException } from '../inertia.interceptor';
import { routeUrl } from '../routes';
import { iso, paginate } from '../serializers';

/** A URL slug as Laravel's `Str::slug` makes one. */
export function kebab(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function plainQuery(query: Record<string, unknown>, keys: string[]) {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = query?.[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

export function serializeArticle(article: KbArticle) {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    body: article.content ?? '',
    excerpt: article.excerpt ?? null,
    status: article.status,
    category_id: article.categoryId ?? null,
    category: article.category ? { id: article.category.id, name: article.category.name } : null,
    author_id: article.authorId ?? null,
    view_count: article.viewCount ?? 0,
    helpful_count: article.helpfulCount ?? 0,
    not_helpful_count: article.notHelpfulCount ?? 0,
    published_at: iso(article.publishedAt),
    created_at: iso(article.createdAt),
    updated_at: iso(article.updatedAt),
  };
}

export function serializeCategory(category: KbCategory, articlesCount = 0) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    parent_id: category.parentId ?? null,
    position: category.sortOrder ?? 0,
    articles_count: articlesCount,
    created_at: iso(category.createdAt),
    updated_at: iso(category.updatedAt),
  };
}

function searchArticles(query: SelectQueryBuilder<KbArticle>, search: unknown) {
  if (typeof search === 'string' && search.trim()) {
    const term = `%${search.trim()}%`;
    query.andWhere(
      new Brackets((q) =>
        q.where('article.title LIKE :term', { term }).orWhere('article.content LIKE :term', {
          term,
        }),
      ),
    );
  }
}

/** Reads shared by the admin and customer knowledge base screens. */
abstract class KnowledgeBaseScreens {
  constructor(
    protected readonly articles: Repository<KbArticle>,
    protected readonly categories: Repository<KbCategory>,
    protected readonly options: EscalatedModuleOptions,
  ) {}

  /** The knowledge base screens are off with `enableKnowledgeBase: false`. */
  protected ensureEnabled() {
    if (this.options?.enableKnowledgeBase === false) throw new NotFoundException();
  }

  protected async articleCounts(publishedOnly: boolean): Promise<Map<number, number>> {
    const query = this.articles
      .createQueryBuilder('article')
      .select('article.categoryId', 'id')
      .addSelect('COUNT(article.id)', 'count')
      .where('article.categoryId IS NOT NULL')
      .groupBy('article.categoryId');
    if (publishedOnly) query.andWhere('article.status = :status', { status: 'published' });
    const rows = await query.getRawMany();
    return new Map(rows.map((row) => [Number(row.id), Number(row.count)]));
  }

  protected async categoryOptions() {
    const rows = await this.categories.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    return rows.map((c) => ({ id: c.id, name: c.name }));
  }
}

/**
 * The admin knowledge base screens (registered with `ui.enabled`), as
 * escalated-laravel's Admin\ArticleController and ArticleCategoryController
 * serve them at `kb-articles` and `kb-categories`.
 */
@UseGuards(EscalatedAdminGuard, ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/admin')
export class AdminKnowledgeBaseUiController extends KnowledgeBaseScreens {
  constructor(
    @InjectRepository(KbArticle) articles: Repository<KbArticle>,
    @InjectRepository(KbCategory) categories: Repository<KbCategory>,
    @Inject(ESCALATED_OPTIONS) options: EscalatedModuleOptions,
    private readonly kb: KnowledgeBaseService,
  ) {
    super(articles, categories, options);
  }

  private async categoryId(value: unknown): Promise<number | null> {
    if (value == null || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || !(await this.categories.existsBy({ id }))) {
      throw new UiValidationException({ category_id: 'The selected category is invalid.' });
    }
    return id;
  }

  /** The slug given or one from the title, which no other article has. */
  private async articleSlug(body: any, title: string, except?: number): Promise<string> {
    const slug = kebab(typeof body?.slug === 'string' && body.slug.trim() ? body.slug : title);
    if (!slug) throw new UiValidationException({ slug: 'The slug field is required.' });
    const taken = await this.articles.existsBy({
      slug,
      ...(except ? { id: Not(except) } : {}),
    });
    if (taken) throw new UiValidationException({ slug: 'The slug has already been taken.' });
    return slug;
  }

  private async articleInput(body: any, except?: number): Promise<Partial<KbArticle>> {
    const title = body?.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 255) {
      throw new UiValidationException({ title: 'The title field is required.' });
    }
    if (!['draft', 'published'].includes(body?.status)) {
      throw new UiValidationException({ status: 'The selected status is invalid.' });
    }
    return {
      title: title.trim(),
      slug: await this.articleSlug(body, title, except),
      content: typeof body?.body === 'string' ? body.body : '',
      status: body.status,
      categoryId: (await this.categoryId(body?.category_id)) as number,
    };
  }

  private toArticles(message: string) {
    return redirect(routeUrl('escalated.admin.kb-articles.index'), { success: message });
  }

  @Get('kb-articles')
  async articleIndex(@Query() query: Record<string, unknown>) {
    this.ensureEnabled();
    const filters = plainQuery(query, ['search', 'status', 'category_id']);
    const page = positiveInt(query?.page, 1);
    const perPage = 20;
    const list = this.articles
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.category', 'category');
    searchArticles(list, filters.search);
    if (filters.status) list.andWhere('article.status = :status', { status: filters.status });
    if (filters.category_id) {
      list.andWhere('article.categoryId = :category', { category: Number(filters.category_id) });
    }
    const [rows, total] = await list
      .orderBy('article.createdAt', 'DESC')
      .addOrderBy('article.id', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();
    return inertia('Escalated/Admin/KnowledgeBase/Articles/Index', {
      articles: paginate(
        rows.map(serializeArticle),
        total,
        page,
        perPage,
        routeUrl('escalated.admin.kb-articles.index'),
        filters,
      ),
      categories: await this.categoryOptions(),
      filters,
    });
  }

  @Get('kb-articles/create')
  async articleCreate() {
    this.ensureEnabled();
    return inertia('Escalated/Admin/KnowledgeBase/Articles/Form', {
      article: null,
      categories: await this.categoryOptions(),
    });
  }

  @Post('kb-articles')
  async articleStore(@Body() body: any, @Req() req: any) {
    this.ensureEnabled();
    await this.kb.createArticle({
      ...(await this.articleInput(body)),
      authorId: requireUserId(req),
    });
    return this.toArticles('Article created.');
  }

  @Get('kb-articles/:id/edit')
  async articleEdit(@Param('id', ParseIntPipe) id: number) {
    this.ensureEnabled();
    return inertia('Escalated/Admin/KnowledgeBase/Articles/Form', {
      article: serializeArticle(await this.kb.findArticleById(id)),
      categories: await this.categoryOptions(),
    });
  }

  @Put('kb-articles/:id')
  async articleUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    this.ensureEnabled();
    await this.kb.findArticleById(id);
    await this.kb.updateArticle(id, await this.articleInput(body, id));
    return this.toArticles('Article updated.');
  }

  @Delete('kb-articles/:id')
  async articleDestroy(@Param('id', ParseIntPipe) id: number) {
    this.ensureEnabled();
    await this.kb.deleteArticle(id);
    return this.toArticles('Article deleted.');
  }

  // Categories

  private async categoryInput(body: any, except?: number): Promise<Partial<KbCategory>> {
    const name = body?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 255) {
      throw new UiValidationException({ name: 'The name field is required.' });
    }
    const slug = kebab(typeof body?.slug === 'string' && body.slug.trim() ? body.slug : name);
    if (!slug) throw new UiValidationException({ slug: 'The slug field is required.' });
    if (await this.categories.existsBy({ slug, ...(except ? { id: Not(except) } : {}) })) {
      throw new UiValidationException({ slug: 'The slug has already been taken.' });
    }
    let parentId: number | null = null;
    if (body?.parent_id != null && body.parent_id !== '') {
      parentId = Number(body.parent_id);
      if (
        !Number.isInteger(parentId) ||
        parentId === except ||
        !(await this.categories.existsBy({ id: parentId }))
      ) {
        throw new UiValidationException({ parent_id: 'The selected parent is invalid.' });
      }
    }
    const position = body?.position == null || body.position === '' ? 0 : Number(body.position);
    if (!Number.isInteger(position) || position < 0) {
      throw new UiValidationException({ position: 'The position must be zero or more.' });
    }
    const description = typeof body?.description === 'string' ? body.description : null;
    if (description && description.length > 1000) {
      throw new UiValidationException({
        description: 'The description may not be greater than 1000 characters.',
      });
    }
    return {
      name: name.trim(),
      slug,
      parentId: parentId as number,
      sortOrder: position,
      description: description as string,
    };
  }

  private toCategories(message: string) {
    return back(routeUrl('escalated.admin.kb-categories.index'), { success: message });
  }

  @Get('kb-categories')
  async categoryIndex() {
    this.ensureEnabled();
    const [rows, counts] = await Promise.all([
      this.categories.find({ order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.articleCounts(false),
    ]);
    return inertia('Escalated/Admin/KnowledgeBase/Categories/Index', {
      categories: rows.map((c) => serializeCategory(c, counts.get(c.id) ?? 0)),
    });
  }

  @Post('kb-categories')
  async categoryStore(@Body() body: any) {
    this.ensureEnabled();
    await this.kb.createCategory(await this.categoryInput(body));
    return this.toCategories('Category created.');
  }

  @Put('kb-categories/:id')
  async categoryUpdate(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    this.ensureEnabled();
    await this.kb.findCategoryById(id);
    await this.kb.updateCategory(id, await this.categoryInput(body, id));
    return this.toCategories('Category updated.');
  }

  @Delete('kb-categories/:id')
  async categoryDestroy(@Param('id', ParseIntPipe) id: number) {
    this.ensureEnabled();
    await this.kb.deleteCategory(id);
    return this.toCategories('Category deleted.');
  }
}

/**
 * The public knowledge base screens (registered with `ui.enabled`), as
 * escalated-laravel's Customer\KnowledgeBaseController serves them: published
 * articles only. Public like the `/escalated/customer/kb` JSON routes.
 */
@UseGuards(ScriptedRequestGuard)
@EscalatedUi()
@Controller('escalated/kb')
export class CustomerKnowledgeBaseUiController extends KnowledgeBaseScreens {
  constructor(
    @InjectRepository(KbArticle) articles: Repository<KbArticle>,
    @InjectRepository(KbCategory) categories: Repository<KbCategory>,
    @Inject(ESCALATED_OPTIONS) options: EscalatedModuleOptions,
    private readonly kb: KnowledgeBaseService,
  ) {
    super(articles, categories, options);
  }

  @Get()
  async index(@Query() query: Record<string, unknown>) {
    this.ensureEnabled();
    const filters = plainQuery(query, ['search', 'category']);
    const page = positiveInt(query?.page, 1);
    const perPage = 15;
    const list = this.articles
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.category', 'category')
      .where('article.status = :published', { published: 'published' });
    searchArticles(list, filters.search);
    if (filters.category) {
      list.andWhere('article.categoryId = :category', { category: Number(filters.category) });
    }
    const [[rows, total], roots, counts] = await Promise.all([
      list
        .orderBy('article.publishedAt', 'DESC')
        .addOrderBy('article.id', 'DESC')
        .skip((page - 1) * perPage)
        .take(perPage)
        .getManyAndCount(),
      this.categories.find({
        where: { parentId: IsNull(), isActive: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.articleCounts(true),
    ]);
    return inertia('Escalated/Customer/KnowledgeBase/Index', {
      categories: roots.map((c) => serializeCategory(c, counts.get(c.id) ?? 0)),
      articles: paginate(
        rows.map(serializeArticle),
        total,
        page,
        perPage,
        routeUrl('escalated.customer.kb.index'),
        filters,
      ),
      filters,
      feedbackEnabled: true,
    });
  }

  private async published(slug: string): Promise<KbArticle> {
    const article = await this.articles.findOne({
      where: { slug, status: 'published' },
      relations: { category: true },
    });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  @Get(':slug')
  async show(@Param('slug') slug: string) {
    this.ensureEnabled();
    const article = await this.published(slug);
    await this.articles.increment({ id: article.id }, 'viewCount', 1);
    article.viewCount = (article.viewCount ?? 0) + 1;
    const related = article.categoryId
      ? await this.articles.find({
          where: { categoryId: article.categoryId, status: 'published', id: Not(article.id) },
          order: { publishedAt: 'DESC', id: 'DESC' },
          take: 5,
        })
      : [];
    return inertia('Escalated/Customer/KnowledgeBase/Article', {
      article: serializeArticle(article),
      related: related.map((r) => ({ id: r.id, title: r.title, slug: r.slug })),
      feedbackEnabled: true,
    });
  }

  @Post(':slug/feedback')
  @HttpCode(200)
  async feedback(@Param('slug') slug: string, @Body() body: any) {
    this.ensureEnabled();
    const article = await this.published(slug);
    const helpful = body?.helpful;
    const value =
      helpful === true || helpful === 1 || helpful === '1' || helpful === 'true'
        ? true
        : helpful === false || helpful === 0 || helpful === '0' || helpful === 'false'
          ? false
          : null;
    if (value === null) {
      throw new UiValidationException({ helpful: 'The helpful field must be true or false.' });
    }
    await this.kb.rateArticle(article.id, value);
    return back(routeUrl('escalated.customer.kb.show', { slug }), {
      success: 'Thank you for your feedback!',
    });
  }
}
