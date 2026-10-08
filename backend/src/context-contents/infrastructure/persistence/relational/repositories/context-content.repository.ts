import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { ContextContent } from '../../../../domain/context-content';
import {
  ContextContentRepository,
  NewContextContent,
} from '../../context-content.repository';
import { ContextContentEntity } from '../entities/context-content.entity';
import { ContextContentMapper } from '../mappers/context-content.mapper';

/** Rows per INSERT, to stay well under Postgres' parameter limit. */
const BATCH = 200;

@Injectable()
export class ContextContentRelationalRepository implements ContextContentRepository {
  constructor(
    @InjectRepository(ContextContentEntity)
    private readonly repository: Repository<ContextContentEntity>,
  ) {}

  async insertMissing(contents: NewContextContent[]): Promise<number> {
    // The same hash can appear twice in one request; insert it once.
    const unique = [
      ...new Map(contents.map((c) => [`${c.projectId}:${c.hash}`, c])).values(),
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
          ) as unknown as QueryDeepPartialEntity<ContextContentEntity>[],
        )
        .orIgnore()
        .returning(['id'])
        .execute();
      // RETURNING only yields the rows that were actually inserted.
      inserted += (result.raw as unknown[]).length;
    }
    return inserted;
  }

  async findByHash(
    projectId: string,
    hash: string,
  ): Promise<NullableType<ContextContent>> {
    const entity = await this.repository.findOne({
      where: { projectId, hash },
    });
    return entity ? ContextContentMapper.toDomain(entity) : null;
  }
}
