import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ReplayResult } from '../../../../domain/replay-result';
import {
  NewReplayResult,
  ReplayResultRepository,
} from '../../replay-result.repository';
import { ReplayResultEntity } from '../entities/replay-result.entity';
import { ReplayResultMapper } from '../mappers/replay-result.mapper';

@Injectable()
export class ReplayResultRelationalRepository implements ReplayResultRepository {
  constructor(
    @InjectRepository(ReplayResultEntity)
    private readonly repository: Repository<ReplayResultEntity>,
  ) {}

  async insert(result: NewReplayResult): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .insert()
      // TypeORM's deep-partial type cannot describe an arbitrary jsonb value.
      .values(result as unknown as QueryDeepPartialEntity<ReplayResultEntity>)
      .orIgnore()
      .execute();
  }

  async findByReplay(replayId: string): Promise<ReplayResult[]> {
    const entities = await this.repository.find({
      where: { replayId },
      order: { requestNumber: 'ASC' },
    });
    return entities.map((entity) => ReplayResultMapper.toDomain(entity));
  }
}
