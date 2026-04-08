import { Controller, Get, Param, Query, Post, Body } from '@nestjs/common';
import { KnowledgeBaseService } from '../../services/knowledge-base.service';

@Controller('escalated/customer/kb')
export class CustomerKnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  @Get('categories')
  async listCategories() {
    return this.kbService.findAllCategories();
  }

  @Get('articles')
  async listArticles(@Query() filters: any) {
    return this.kbService.findAllArticles({ ...filters, status: 'published' });
  }

  @Get('articles/:slug')
  async showArticle(@Param('slug') slug: string) {
    return this.kbService.findArticleBySlug(slug);
  }

  @Get('search')
  async search(@Query('q') query: string) {
    return this.kbService.searchArticles(query || '');
  }

  @Post('articles/:id/rate')
  async rateArticle(@Param('id') id: number, @Body('helpful') helpful: boolean) {
    await this.kbService.rateArticle(id, helpful);
    return { success: true };
  }
}
