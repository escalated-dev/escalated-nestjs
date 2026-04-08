import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  UseInterceptors,
} from '@nestjs/common';
import { KnowledgeBaseService } from '../../services/knowledge-base.service';
import { AuditLogInterceptor, AuditAction } from '../../interceptors/audit-log.interceptor';

@Controller('escalated/admin/kb')
@UseInterceptors(AuditLogInterceptor)
export class AdminKnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  // Categories
  @Get('categories')
  async listCategories() {
    return this.kbService.findAllCategories();
  }

  @Post('categories')
  @AuditAction('create', 'kb_category')
  async createCategory(@Body() body: any) {
    return this.kbService.createCategory(body);
  }

  @Put('categories/:id')
  @AuditAction('update', 'kb_category')
  async updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.kbService.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(@Param('id', ParseIntPipe) id: number) {
    await this.kbService.deleteCategory(id);
  }

  // Articles
  @Get('articles')
  async listArticles(@Query() filters: any) {
    return this.kbService.findAllArticles(filters);
  }

  @Get('articles/:id')
  async showArticle(@Param('id', ParseIntPipe) id: number) {
    return this.kbService.findArticleById(id);
  }

  @Post('articles')
  @AuditAction('create', 'kb_article')
  async createArticle(@Body() body: any) {
    return this.kbService.createArticle(body);
  }

  @Put('articles/:id')
  @AuditAction('update', 'kb_article')
  async updateArticle(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.kbService.updateArticle(id, body);
  }

  @Delete('articles/:id')
  @HttpCode(204)
  async deleteArticle(@Param('id', ParseIntPipe) id: number) {
    await this.kbService.deleteArticle(id);
  }
}
