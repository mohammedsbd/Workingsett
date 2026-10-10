import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { ArchivedItem } from '../../../../domain/archived-item';
import {
  ArchivedItemRepository,
  NewArchivedItem,
} from '../../archived-item.repository';
import { ArchivedItemEntity } from '../entities/archived-item.entity';
import { ArchivedItemMapper } from '../mappers/archived-item.mapper';

/** Rows per INSERT, to stay well under Postgres' parameter limit. */
const BATCH = 200;

@Injectable()
export class ArchivedItemRelationalRepository implements ArchivedItemRepository {
  constructor(
    @InjectRepository(ArchivedItemEntity)
    private readonly repository: Repository<ArchivedItemEntity>,
  ) {}

  async insertMissing(items: NewArchivedItem[]): Promise<number> {
    // Identical content in one request has one archive id; store it once.
    const unique = [
      ...new Map(
        items.map((item) => [`${item.projectId}:${item.archiveId}`, item]),
      ).values(),
    ];
    let inserted = 0;
    for (let i = 0; i < unique.length; i += BATCH) {
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        // TypeORM's deep-partial type cannot describe an arbitrary jsonb value.
        .values(
          unique.slice(
            i,
            i + BATCH,
          ) as unknown as QueryDeepPartialEntity<ArchivedItemEntity>[],
        )
        .orIgnore()
        .returning(['id'])
        .execute();
      // RETURNING only yields the rows that were actually inserted.
      inserted += (result.raw as unknown[]).length;
    }
    return inserted;
  }

  async findByArchiveId(
    projectId: string,
    archiveId: string,
  ): Promise<NullableType<ArchivedItem>> {
    const entity = await this.repository.findOne({
      where: { projectId, archiveId },
    });
    return entity ? ArchivedItemMapper.toDomain(entity) : null;
  }
}
