import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recall } from '../../../../domain/recall';
import { NewRecall, RecallRepository } from '../../recall.repository';
import { RecallEntity } from '../entities/recall.entity';
import { RecallMapper } from '../mappers/recall.mapper';

@Injectable()
export class RecallRelationalRepository implements RecallRepository {
  constructor(
    @InjectRepository(RecallEntity)
    private readonly repository: Repository<RecallEntity>,
  ) {}

  async createMany(recalls: NewRecall[]): Promise<void> {
    if (recalls.length) await this.repository.insert(recalls);
  }

  async findByProject(projectId: string): Promise<Recall[]> {
    const entities = await this.repository.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => RecallMapper.toDomain(entity));
  }
}
