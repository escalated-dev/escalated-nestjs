import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KbArticle, KbCategory } from '../../src/entities';
import { ADMIN, bootUi, cookieFrom, expectManifestProps, inertiaFetch, page } from './ui-harness';

jest.setTimeout(60000);

/**
 * The knowledge base screens over real HTTP and SQLite, with
 * escalated-laravel's Admin\ArticleController, ArticleCategoryController and
 * Customer\KnowledgeBaseController as the contract.
 */
describe('knowledge base screens (ui.enabled)', () => {
  let app: INestApplication;
  let source: DataSource;
  let base: string;
  let billing: KbCategory;
  let child: KbCategory;
  let refunds: KbArticle;
  let invoices: KbArticle;
  let draft: KbArticle;

  const asAdmin = { as: 'admin' as const };

  const submit = (path: string, body: unknown, method = 'POST', from = path) =>
    inertiaFetch(base, path, {
      ...asAdmin,
      method,
      body,
      headers: { referer: `${base}${from}` },
    });

  const follow = (res: Response, as: 'admin' | 'customer' = 'admin') =>
    page(base, res.headers.get('location')!, { as, headers: { cookie: cookieFrom(res) } });

  beforeAll(async () => {
    ({ app, source, base } = await bootUi());
    const categories = source.getRepository(KbCategory);
    billing = await categories.save({ name: 'Billing', slug: 'billing', description: 'Money' });
    child = await categories.save({ name: 'Refunds', slug: 'refunds-cat', parentId: billing.id });
    const articles = source.getRepository(KbArticle);
    refunds = await articles.save({
      title: 'How refunds work',
      slug: 'how-refunds-work',
      content: 'Refunds take five days.',
      status: 'published',
      publishedAt: new Date('2026-01-02'),
      categoryId: billing.id,
    });
    invoices = await articles.save({
      title: 'Reading your invoice',
      slug: 'reading-your-invoice',
      content: 'Invoices list charges.',
      status: 'published',
      publishedAt: new Date('2026-01-01'),
      categoryId: billing.id,
    });
    draft = await articles.save({
      title: 'Secret draft',
      slug: 'secret-draft',
      content: 'Not yet.',
      status: 'draft',
      categoryId: billing.id,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('admin', () => {
    it('keeps the admin knowledge base behind the admin guard', async () => {
      const res = await inertiaFetch(base, '/escalated/admin/kb-articles', { as: 'agent' });
      expect(res.status).toBe(403);
    });

    it('lists articles with filters, paginated, with the category options', async () => {
      const result = await page(base, '/escalated/admin/kb-articles?status=draft', asAdmin);
      expect(result.component).toBe('Escalated/Admin/KnowledgeBase/Articles/Index');
      expectManifestProps(result);
      expect(result.props.filters).toEqual({ status: 'draft' });
      expect(result.props.articles).toMatchObject({ total: 1, current_page: 1, per_page: 20 });
      expect(result.props.articles.data[0]).toMatchObject({
        id: draft.id,
        title: 'Secret draft',
        status: 'draft',
        category: { id: billing.id, name: 'Billing' },
        view_count: 0,
        helpful_count: 0,
      });
      expect(result.props.categories).toContainEqual({ id: billing.id, name: 'Billing' });

      const searched = await page(base, '/escalated/admin/kb-articles?search=invoice', asAdmin);
      expect(searched.props.articles.data.map((a: any) => a.id)).toEqual([invoices.id]);
    });

    it('creates, edits and deletes an article', async () => {
      const create = await page(base, '/escalated/admin/kb-articles/create', asAdmin);
      expect(create.component).toBe('Escalated/Admin/KnowledgeBase/Articles/Form');
      expectManifestProps(create);
      expect(create.props.article).toBeNull();

      const res = await submit('/escalated/admin/kb-articles', {
        title: 'Changing your plan',
        slug: '',
        body: 'Go to settings.',
        status: 'published',
        category_id: billing.id,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/kb-articles');
      expect((await follow(res)).props.flash.success).toBe('Article created.');
      const article = await source
        .getRepository(KbArticle)
        .findOneByOrFail({ slug: 'changing-your-plan' });
      expect(article).toMatchObject({
        content: 'Go to settings.',
        status: 'published',
        categoryId: billing.id,
        authorId: ADMIN,
      });
      expect(article.publishedAt).toBeTruthy();

      const edit = await page(base, `/escalated/admin/kb-articles/${article.id}/edit`, asAdmin);
      expect(edit.props.article).toMatchObject({
        id: article.id,
        body: 'Go to settings.',
        category_id: billing.id,
      });

      await submit(
        `/escalated/admin/kb-articles/${article.id}`,
        { title: 'Changing plans', slug: 'plans', body: 'New', status: 'draft', category_id: '' },
        'PUT',
      );
      expect(
        await source.getRepository(KbArticle).findOneByOrFail({ id: article.id }),
      ).toMatchObject({
        title: 'Changing plans',
        slug: 'plans',
        status: 'draft',
        categoryId: null,
      });

      await submit(`/escalated/admin/kb-articles/${article.id}`, undefined, 'DELETE');
      expect(await source.getRepository(KbArticle).countBy({ id: article.id })).toBe(0);
    });

    it('sends a taken slug or a missing title back with errors', async () => {
      const taken = await submit(
        '/escalated/admin/kb-articles',
        { title: 'Dup', slug: 'how-refunds-work', status: 'draft' },
        'POST',
        '/escalated/admin/kb-articles/create',
      );
      expect(Object.keys((await follow(taken)).props.errors)).toEqual(['slug']);
      const untitled = await submit(
        '/escalated/admin/kb-articles',
        { title: '', status: 'draft' },
        'POST',
        '/escalated/admin/kb-articles/create',
      );
      expect(Object.keys((await follow(untitled)).props.errors)).toEqual(['title']);
    });

    it('lists, creates, updates and deletes categories', async () => {
      const result = await page(base, '/escalated/admin/kb-categories', asAdmin);
      expect(result.component).toBe('Escalated/Admin/KnowledgeBase/Categories/Index');
      expectManifestProps(result);
      expect(result.props.categories).toContainEqual(
        expect.objectContaining({
          id: billing.id,
          name: 'Billing',
          slug: 'billing',
          description: 'Money',
          parent_id: null,
          position: 0,
          articles_count: 3,
        }),
      );
      expect(result.props.categories).toContainEqual(
        expect.objectContaining({ id: child.id, parent_id: billing.id }),
      );

      const res = await submit('/escalated/admin/kb-categories', {
        name: 'Getting Started',
        slug: '',
        parent_id: '',
        position: 2,
        description: 'Basics',
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/escalated/admin/kb-categories');
      const created = await source
        .getRepository(KbCategory)
        .findOneByOrFail({ slug: 'getting-started' });
      expect(created).toMatchObject({ sortOrder: 2, description: 'Basics', parentId: null });

      await submit(
        `/escalated/admin/kb-categories/${created.id}`,
        { name: 'Start here', slug: 'start', parent_id: billing.id, position: 1 },
        'PUT',
      );
      expect(
        await source.getRepository(KbCategory).findOneByOrFail({ id: created.id }),
      ).toMatchObject({ name: 'Start here', slug: 'start', parentId: billing.id });

      const self = await submit(
        `/escalated/admin/kb-categories/${created.id}`,
        { name: 'Loop', parent_id: created.id },
        'PUT',
        '/escalated/admin/kb-categories',
      );
      expect(Object.keys((await follow(self)).props.errors)).toEqual(['parent_id']);

      await submit(`/escalated/admin/kb-categories/${created.id}`, undefined, 'DELETE');
      expect(await source.getRepository(KbCategory).countBy({ id: created.id })).toBe(0);
    });
  });

  describe('customer', () => {
    it('lists published articles and root categories with published counts', async () => {
      const result = await page(base, '/escalated/kb', { as: 'customer' });
      expect(result.component).toBe('Escalated/Customer/KnowledgeBase/Index');
      expectManifestProps(result);
      expect(result.props.articles.data.map((a: any) => a.id)).toEqual([refunds.id, invoices.id]);
      expect(result.props.articles).toMatchObject({ per_page: 15, total: 2 });
      expect(result.props.categories).toEqual([
        expect.objectContaining({ id: billing.id, description: 'Money', articles_count: 2 }),
      ]);
      expect(result.props.feedbackEnabled).toBe(true);

      const filtered = await page(base, `/escalated/kb?search=invoice&category=${billing.id}`, {
        as: 'customer',
      });
      expect(filtered.props.filters).toEqual({ search: 'invoice', category: String(billing.id) });
      expect(filtered.props.articles.data.map((a: any) => a.id)).toEqual([invoices.id]);
    });

    it('is public, like the knowledge base JSON routes', async () => {
      const res = await fetch(`${base}/escalated/kb`, {
        headers: { 'x-inertia': 'true', accept: 'text/html' },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).props.auth.user).toBeNull();
    });

    it('shows a published article with related ones, counting the view', async () => {
      const result = await page(base, '/escalated/kb/how-refunds-work', { as: 'customer' });
      expect(result.component).toBe('Escalated/Customer/KnowledgeBase/Article');
      expectManifestProps(result);
      expect(result.props.article).toMatchObject({
        id: refunds.id,
        title: 'How refunds work',
        body: 'Refunds take five days.',
        category: { id: billing.id, name: 'Billing' },
        published_at: expect.any(String),
        view_count: 1,
      });
      expect(result.props.related).toEqual([
        { id: invoices.id, title: 'Reading your invoice', slug: 'reading-your-invoice' },
      ]);
      expect(
        (await source.getRepository(KbArticle).findOneByOrFail({ id: refunds.id })).viewCount,
      ).toBe(1);
    });

    it('hides drafts', async () => {
      const res = await inertiaFetch(base, '/escalated/kb/secret-draft', { as: 'customer' });
      expect(res.status).toBe(404);
    });

    it('records helpful feedback', async () => {
      const show = '/escalated/kb/reading-your-invoice';
      const res = await inertiaFetch(base, `${show}/feedback`, {
        as: 'customer',
        body: { helpful: true },
        headers: { referer: `${base}${show}` },
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(show);
      expect((await follow(res, 'customer')).props.flash.success).toBe(
        'Thank you for your feedback!',
      );
      await inertiaFetch(base, `${show}/feedback`, { as: 'customer', body: { helpful: false } });
      expect(
        await source.getRepository(KbArticle).findOneByOrFail({ id: invoices.id }),
      ).toMatchObject({ helpfulCount: 1, notHelpfulCount: 1 });
    });

    it('names every route the knowledge base screens call', async () => {
      const result = await page(base, '/escalated/kb', { as: 'customer' });
      const routes = Object.keys(result.props.ziggy.routes);
      for (const name of [
        'escalated.customer.kb.index',
        'escalated.customer.kb.show',
        'escalated.customer.kb.feedback',
        'escalated.admin.kb-articles.index',
        'escalated.admin.kb-articles.create',
        'escalated.admin.kb-articles.store',
        'escalated.admin.kb-articles.edit',
        'escalated.admin.kb-articles.update',
        'escalated.admin.kb-articles.destroy',
        'escalated.admin.kb-categories.index',
        'escalated.admin.kb-categories.store',
        'escalated.admin.kb-categories.update',
        'escalated.admin.kb-categories.destroy',
      ]) {
        expect(routes).toContain(name);
      }
    });
  });
});

describe('knowledge base screens with the knowledge base off', () => {
  it('serves none of them', async () => {
    const { app, base } = await bootUi({ enableKnowledgeBase: false });
    try {
      expect((await inertiaFetch(base, '/escalated/kb', { as: 'customer' })).status).toBe(404);
      expect(
        (await inertiaFetch(base, '/escalated/admin/kb-articles', { as: 'admin' })).status,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
