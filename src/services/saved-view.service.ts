import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedView } from '../entities/saved-view.entity';

@Injectable()
export class SavedViewService {
  constructor(
    @InjectRepository(SavedView)
    private readonly viewRepo: Repository<SavedView>,
  ) {}

  async findAll(userId?: number): Promise<SavedView[]> {
    const qb = this.viewRepo
      .createQueryBuilder('view')
      .where('(view.isShared = :isShared OR view.userId = :userId)', {
        isShared: true,
        userId: userId || 0,
      })
      .orderBy('view.sortOrder', 'ASC');

    return qb.getMany();
  }

  async findById(id: number): Promise<SavedView> {
    const view = await this.viewRepo.findOne({ where: { id } });
    if (!view) throw new NotFoundException(`Saved view #${id} not found`);
    return view;
  }

  async create(data: Partial<SavedView>): Promise<SavedView> {
    const view = this.viewRepo.create(data);
    return this.viewRepo.save(view);
  }

  async update(id: number, data: Partial<SavedView>): Promise<SavedView> {
    await this.findById(id);
    await this.viewRepo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    const view = await this.findById(id);
    await this.viewRepo.remove(view);
  }

  async setDefault(id: number, userId: number): Promise<SavedView> {
    // Unset previous default for this user
    await this.viewRepo.update({ userId, isDefault: true }, { isDefault: false });
    await this.viewRepo.update(id, { isDefault: true });
    return this.findById(id);
  }
}
