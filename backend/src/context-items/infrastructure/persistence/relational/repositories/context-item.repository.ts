import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContextItem } from '../../../../domain/context-item';
import {
  ContextItemRepository,
  NewContextItem,
} from '../../context-item.repository';
import { ContextItemEntity } from '../entities/context-item.entity';
import { ContextItemMapper } from '../mappers/context-item.mapper';

/** Rows per INSERT, to stay well under Postgres' parameter limit. */
const BATCH = 500;

@Injectable()
export class ContextItemRelationalRepository implements ContextItemRepository {
  constructor(
    @InjectRepository(ContextItemEntity)
    private readonly repository: Repository<ContextItemEntity>,
  ) {}

  async insertMissing(items: NewContextItem[]): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        .values(items.slice(i, i + BATCH))
        .orIgnore()
        .returning(['id'])
        .execute();
      // RETURNING only yields the rows that were actually inserted.
      inserted += (result.raw as unknown[]).length;
    }
    return inserted;
  }

  findKeys(
    agentSessionId: string,
  ): Promise<Pick<ContextItem, 'position' | 'contentHash'>[]> {
    return this.repository.find({
      select: { position: true, contentHash: true },
      where: { agentSessionId },
    });
  }

  async findBySession(agentSessionId: string): Promise<ContextItem[]> {
    const entities = await this.repository.find({
      where: { agentSessionId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return entities.map((entity) => ContextItemMapper.toDomain(entity));
  }
}
