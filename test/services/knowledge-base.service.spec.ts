import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KnowledgeBaseService } from '../../src/services/knowledge-base.service';
import { KbCategory } from '../../src/entities/kb-category.entity';
import { KbArticle } from '../../src/entities/kb-article.entity';

describe('KnowledgeBaseService', () => {
  let service: KnowledgeBaseService;
  let categoryRepo: any;
  let articleRepo: any;

  const mockCategory = { id: 1, name: 'Getting Started', slug: 'getting-started', isActive: true };
  const mockArticle = {
    id: 1,
    title: 'How to Create a Ticket',
    slug: 'how-to-create-a-ticket',
    content: 'Article content here',
    status: 'published',
    viewCount: 10,
    categoryId: 1,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeBaseService,
        {
          provide: getRepositoryToken(KbCategory),
          useValue: {
            find: jest.fn().mockResolvedValue([mockCategory]),
            findOne: jest.fn().mockResolvedValue(mockCategory),
            create: jest.fn().mockReturnValue(mockCategory),
            save: jest.fn().mockResolvedValue(mockCategory),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockCategory),
          },
        },
        {
          provide: getRepositoryToken(KbArticle),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockArticle),
            create: jest.fn().mockReturnValue(mockArticle),
            save: jest.fn().mockResolvedValue(mockArticle),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue(mockArticle),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[mockArticle], 1]),
              getMany: jest.fn().mockResolvedValue([mockArticle]),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<KnowledgeBaseService>(KnowledgeBaseService);
    categoryRepo = module.get(getRepositoryToken(KbCategory));
    articleRepo = module.get(getRepositoryToken(KbArticle));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('categories', () => {
    it('should return all categories', async () => {
      const result = await service.findAllCategories();
      expect(result).toHaveLength(1);
    });

    it('should create a category', async () => {
      await service.createCategory({ name: 'FAQ', slug: 'faq' });
      expect(categoryRepo.save).toHaveBeenCalled();
    });
  });

  describe('articles', () => {
    it('should return paginated articles', async () => {
      const result = await service.findAllArticles({ page: 1, perPage: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should find article by slug and increment views', async () => {
      await service.findArticleBySlug('how-to-create-a-ticket');

      expect(articleRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ viewCount: expect.anything() }),
      );
    });

    it('should search articles', async () => {
      const result = await service.searchArticles('ticket');
      expect(result).toHaveLength(1);
    });

    it('should rate article as helpful', async () => {
      await service.rateArticle(1, true);
      expect(articleRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ helpfulCount: expect.anything() }),
      );
    });
  });
});
