import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KbCategory } from '../entities/kb-category.entity';
import { KbArticle } from '../entities/kb-article.entity';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KbCategory)
    private readonly categoryRepo: Repository<KbCategory>,
    @InjectRepository(KbArticle)
    private readonly articleRepo: Repository<KbArticle>,
  ) {}

  // Categories
  async findAllCategories(): Promise<KbCategory[]> {
    return this.categoryRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
      relations: ['articles'],
    });
  }

  async findCategoryById(id: number): Promise<KbCategory> {
    const category = await this.categoryRepo.findOne({
      where: { id },
      relations: ['articles'],
    });
    if (!category) throw new NotFoundException(`Category #${id} not found`);
    return category;
  }

  async createCategory(data: Partial<KbCategory>): Promise<KbCategory> {
    const category = this.categoryRepo.create(data);
    return this.categoryRepo.save(category);
  }

  async updateCategory(id: number, data: Partial<KbCategory>): Promise<KbCategory> {
    await this.findCategoryById(id);
    await this.categoryRepo.update(id, data);
    return this.findCategoryById(id);
  }

  async deleteCategory(id: number): Promise<void> {
    const category = await this.findCategoryById(id);
    await this.categoryRepo.remove(category);
  }

  // Articles
  async findAllArticles(filters?: {
    categoryId?: number;
    status?: string;
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ data: KbArticle[]; total: number }> {
    const qb = this.articleRepo
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.category', 'category');

    if (filters?.categoryId) {
      qb.andWhere('article.categoryId = :categoryId', { categoryId: filters.categoryId });
    }

    if (filters?.status) {
      qb.andWhere('article.status = :status', { status: filters.status });
    }

    if (filters?.search) {
      qb.andWhere('(article.title LIKE :search OR article.content LIKE :search)', {
        search: `%${filters.search}%`,
      });
    }

    qb.orderBy('article.sortOrder', 'ASC');

    const page = filters?.page || 1;
    const perPage = filters?.perPage || 25;
    qb.skip((page - 1) * perPage).take(perPage);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findArticleById(id: number): Promise<KbArticle> {
    const article = await this.articleRepo.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!article) throw new NotFoundException(`Article #${id} not found`);
    return article;
  }

  async findArticleBySlug(slug: string): Promise<KbArticle> {
    const article = await this.articleRepo.findOne({
      where: { slug, status: 'published' },
      relations: ['category'],
    });
    if (!article) throw new NotFoundException(`Article not found`);

    // Increment view count
    await this.articleRepo.update(article.id, { viewCount: () => 'viewCount + 1' });

    return article;
  }

  async createArticle(data: Partial<KbArticle>): Promise<KbArticle> {
    const article = this.articleRepo.create(data);
    if (data.status === 'published') {
      article.publishedAt = new Date();
    }
    return this.articleRepo.save(article);
  }

  async updateArticle(id: number, data: Partial<KbArticle>): Promise<KbArticle> {
    const existing = await this.findArticleById(id);

    if (data.status === 'published' && existing.status !== 'published') {
      data.publishedAt = new Date();
    }

    await this.articleRepo.update(id, data);
    return this.findArticleById(id);
  }

  async deleteArticle(id: number): Promise<void> {
    const article = await this.findArticleById(id);
    await this.articleRepo.remove(article);
  }

  async rateArticle(id: number, helpful: boolean): Promise<void> {
    await this.findArticleById(id);
    if (helpful) {
      await this.articleRepo.update(id, { helpfulCount: () => 'helpfulCount + 1' });
    } else {
      await this.articleRepo.update(id, { notHelpfulCount: () => 'notHelpfulCount + 1' });
    }
  }

  // Public endpoint for widget
  async searchArticles(query: string): Promise<KbArticle[]> {
    return this.articleRepo
      .createQueryBuilder('article')
      .where('article.status = :status', { status: 'published' })
      .andWhere('(article.title LIKE :query OR article.content LIKE :query)', {
        query: `%${query}%`,
      })
      .orderBy('article.viewCount', 'DESC')
      .take(10)
      .getMany();
  }
}
